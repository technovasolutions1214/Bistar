"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "@bistar/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Button, Input, useToast } from "@bistar/ui";
import type { Content } from "@bistar/shared";

const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024; // mirrors storage.rules /videos limit
const UPLOAD_CONCURRENCY = 2;

type RowStatus = "pending" | "uploading" | "saving" | "done" | "failed";

interface BulkRow {
  id: string;
  file: File;
  title: string;
  description: string;
  season: string;
  episode: string;
  thumbFile: File | null;
  thumbPreview: string;
  progress: number;
  status: RowStatus;
  error?: string;
  // Firestore ids created on the first attempt — reused on retry so a failed
  // row never spawns duplicate content/video docs. ownContent records whether
  // this row created its content doc (movies mode), so cleanup never deletes
  // a pre-existing series even if the mode toggle changed since the attempt.
  contentId?: string;
  videoId?: string;
  ownContent?: boolean;
  orderIndex?: number;
}

// "The.Great.Heist.S01E02.1080p.mp4" -> "The Great Heist S01E02 1080p"
function titleFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Pulls S01E02 / 1x02 / E02 style markers out of a filename. Patterns require
// separators/boundaries so resolution strings (1280x720) and words containing
// "e<digits>" (Blade2, Se7en) don't false-positive.
function parseSeasonEpisode(name: string): { season: string; episode: string } {
  let m = name.match(/(?:^|[\s._-])[sS](\d{1,2})[\s._-]*[eE](\d{1,3})(?=[\s._-]|$)/);
  if (m) return { season: String(parseInt(m[1])), episode: String(parseInt(m[2])) };
  m = name.match(/(?:^|[\s._-])(\d{1,2})x(\d{1,3})(?=[\s._-]|$)/);
  if (m) return { season: String(parseInt(m[1])), episode: String(parseInt(m[2])) };
  m = name.match(/(?:^|[\s._-])[eE]p?[\s._-]*(\d{1,3})(?=[\s._-]|$)/);
  if (m) return { season: "", episode: String(parseInt(m[1])) };
  return { season: "", episode: "" };
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BulkUploadPage() {
  const router = useRouter();
  const toast = useToast();

  const [mode, setMode] = useState<"movies" | "episodes">("movies");
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const cancelRef = useRef(false);

  // Always-fresh mirror of rows so the upload workers see edits made after
  // the upload started (the queue holds click-time snapshots otherwise).
  const rowsRef = useRef<BulkRow[]>(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // Episodes mode: pick the series the files belong to
  const [seriesList, setSeriesList] = useState<Content[]>([]);
  const [seriesId, setSeriesId] = useState("");
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [existingVideoCount, setExistingVideoCount] = useState(0);

  // Movies mode defaults applied to every created content doc
  const [publishImmediately, setPublishImmediately] = useState(false);

  useEffect(() => {
    if (mode !== "episodes" || seriesList.length > 0) return;
    setSeriesLoading(true);
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db(), "content"), orderBy("createdAt", "desc"))
        );
        setSeriesList(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Content))
            .filter((c) => c.type === "series")
        );
      } catch (err) {
        console.error("Failed to fetch series:", err);
        toast.error("Failed to load series list");
      } finally {
        setSeriesLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Informational only — the authoritative count is re-fetched in startUpload.
  useEffect(() => {
    if (!seriesId) {
      setExistingVideoCount(0);
      return;
    }
    (async () => {
      try {
        const snap = await getDocs(collection(db(), "content", seriesId, "videos"));
        setExistingVideoCount(snap.size);
      } catch {
        setExistingVideoCount(0);
      }
    })();
  }, [seriesId]);

  // Warn before leaving mid-upload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (uploading) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading]);

  const addVideoFiles = (files: File[]) => {
    const videos = files.filter((f) => f.type.startsWith("video/"));
    if (videos.length === 0) return;
    // Dedupe against rows still in flight; "done" rows don't block a
    // deliberate re-upload of the same file.
    const active = rowsRef.current.filter((r) => r.status !== "done");
    const fresh = videos.filter(
      (f) => !active.some((r) => r.file.name === f.name && r.file.size === f.size)
    );
    const dropped = videos.length - fresh.length;
    if (dropped > 0) {
      toast.error(`Skipped ${dropped} file${dropped === 1 ? "" : "s"} already in the queue`);
    }
    if (fresh.length === 0) return;
    const newRows = fresh.map((f) => {
      const se = parseSeasonEpisode(f.name);
      return {
        id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        title: titleFromFilename(f.name),
        description: "",
        season: se.season,
        episode: se.episode,
        thumbFile: null,
        thumbPreview: "",
        progress: 0,
        status: "pending" as RowStatus,
      };
    });
    setRows((prev) => [...prev, ...newRows]);
  };

  // Images are matched to videos that share a basename, e.g. heist.mp4 + heist.jpg
  const addImageFiles = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    const matches = rowsRef.current
      .filter((r) => r.status === "pending")
      .map((row) => ({
        rowId: row.id,
        img: images.find((i) => baseName(i.name) === baseName(row.file.name)),
      }))
      .filter((m): m is { rowId: string; img: File } => !!m.img);
    if (matches.length === 0) {
      toast.error("No image filenames matched the video filenames");
      return;
    }
    setRows((prev) =>
      prev.map((r) => {
        const m = matches.find((x) => x.rowId === r.id);
        return m ? { ...r, thumbFile: m.img, thumbPreview: "" } : r;
      })
    );
    for (const m of matches) {
      const reader = new FileReader();
      reader.onloadend = () =>
        setRows((rs) =>
          rs.map((r) => (r.id === m.rowId ? { ...r, thumbPreview: reader.result as string } : r))
        );
      reader.readAsDataURL(m.img);
    }
    toast.success(`Matched ${matches.length} thumbnail${matches.length === 1 ? "" : "s"}`);
  };

  const setRowThumb = (rowId: string, file: File | null) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, thumbFile: file, thumbPreview: "" } : r))
    );
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () =>
        setRows((prev) =>
          prev.map((r) => (r.id === rowId ? { ...r, thumbPreview: reader.result as string } : r))
        );
      reader.readAsDataURL(file);
    }
  };

  const updateRow = (rowId: string, patch: Partial<BulkRow>) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  };

  // Removing a failed row also cleans up the Firestore docs its attempts
  // created, so abandoned retries don't leave orphans in the catalog.
  const removeRow = async (rowId: string) => {
    const row = rowsRef.current.find((r) => r.id === rowId);
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    if (!row || row.status !== "failed") return;
    try {
      if (row.contentId && row.videoId) {
        await deleteDoc(doc(db(), "content", row.contentId, "videos", row.videoId));
      }
      if (row.ownContent && row.contentId) {
        await deleteDoc(doc(db(), "content", row.contentId));
      }
    } catch (err) {
      console.error("Failed to clean up docs for removed row:", err);
    }
  };

  const uploadFileWithProgress = (
    file: File,
    path: string,
    onProgress?: (pct: number) => void
  ): Promise<string> => {
    const storageRef = ref(storage(), path);
    const task = uploadBytesResumable(storageRef, file);
    return new Promise((resolve, reject) => {
      task.on(
        "state_changed",
        (snapshot) => {
          onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
        },
        reject,
        async () => {
          try {
            resolve(await getDownloadURL(task.snapshot.ref));
          } catch (err) {
            reject(err);
          }
        }
      );
    });
  };

  // Creates the content doc (movies mode) and the video doc, then uploads the
  // video file last so the storage-triggered transcoder always finds its doc.
  // Doc ids persist on the row, so retries update the same docs.
  const processRow = async (rowId: string, orderIndex: number): Promise<"done" | "failed"> => {
    const row = rowsRef.current.find((r) => r.id === rowId);
    if (!row) return "failed";

    if (row.file.size >= MAX_VIDEO_BYTES) {
      updateRow(rowId, { status: "failed", error: "File exceeds the 5 GB upload limit" });
      return "failed";
    }

    updateRow(rowId, { status: "uploading", progress: 0, error: undefined });
    try {
      let contentId: string;
      let thumbnailUrl = "";

      if (mode === "movies") {
        contentId = row.contentId ?? doc(collection(db(), "content")).id;
        updateRow(rowId, { contentId, ownContent: true });

        if (row.thumbFile) {
          thumbnailUrl = await uploadFileWithProgress(
            row.thumbFile,
            `thumbnails/content/${contentId}/${Date.now()}_${row.thumbFile.name}`
          );
        }

        await setDoc(doc(db(), "content", contentId), {
          title: row.title.trim(),
          description: row.description.trim(),
          type: "movie",
          genre: [],
          rating: null,
          thumbnail: thumbnailUrl,
          banner: "",
          status: publishImmediately ? "published" : "draft",
          isTrending: false,
          isFeatured: false,
          releaseDate: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        contentId = seriesId;
        updateRow(rowId, { contentId, ownContent: false });
        if (row.thumbFile) {
          thumbnailUrl = await uploadFileWithProgress(
            row.thumbFile,
            `thumbnails/videos/${contentId}/${Date.now()}_${row.thumbFile.name}`
          );
        }
      }

      const videoId = row.videoId ?? doc(collection(db(), "content", contentId, "videos")).id;
      updateRow(rowId, { videoId });
      const storagePath = `videos/${contentId}/${videoId}/original/${row.file.name}`;

      updateRow(rowId, { status: "saving" });
      await setDoc(doc(db(), "content", contentId, "videos", videoId), {
        contentId,
        title: row.title.trim(),
        description: row.description.trim(),
        // Season/episode only make sense for series; movies always get null
        // even when the filename parser found something (the UI hides the
        // fields in movies mode, so a parsed value would be invisible).
        season: mode === "episodes" && row.season ? parseInt(row.season) : null,
        episode: mode === "episodes" && row.episode ? parseInt(row.episode) : null,
        videoUrl: "",
        storageRef: storagePath,
        thumbnailUrl,
        duration: 0,
        status: "processing",
        order: mode === "episodes" ? orderIndex : 0,
        createdAt: serverTimestamp(),
      });

      updateRow(rowId, { status: "uploading" });
      await uploadFileWithProgress(row.file, storagePath, (pct) =>
        updateRow(rowId, { progress: pct })
      );

      updateRow(rowId, { status: "done", progress: 100 });
      return "done";
    } catch (err) {
      console.error(`Bulk upload failed for ${row.file.name}:`, err);
      updateRow(rowId, {
        status: "failed",
        error: err instanceof Error ? err.message : "Upload failed",
      });
      return "failed";
    }
  };

  const startUpload = async () => {
    if (mode === "episodes" && !seriesId) {
      toast.error("Select the series these episodes belong to");
      return;
    }
    const queue = rowsRef.current.filter(
      (r) => r.status === "pending" || r.status === "failed"
    );
    if (queue.length === 0) return;
    const invalid = queue.find((r) => !r.title.trim());
    if (invalid) {
      toast.error(`"${invalid.file.name}" needs a title`);
      return;
    }

    setUploading(true);
    cancelRef.current = false;

    // Episodes append after whatever the series has RIGHT NOW — re-fetched
    // here so a second batch (or a slow first fetch) can't reuse order
    // numbers. Rows that already got an index on a previous attempt keep it.
    let orderBase = 0;
    if (mode === "episodes") {
      try {
        const snap = await getDocs(collection(db(), "content", seriesId, "videos"));
        orderBase = snap.size;
      } catch (err) {
        console.error("Failed to count existing videos:", err);
        toast.error("Could not read the series — try again");
        setUploading(false);
        return;
      }
    }
    for (const r of queue) {
      if (r.orderIndex === undefined) {
        updateRow(r.id, { orderIndex: orderBase });
        r.orderIndex = orderBase;
        orderBase++;
      }
    }

    let next = 0;
    let doneCount = 0;
    let failCount = 0;
    const worker = async () => {
      while (next < queue.length && !cancelRef.current) {
        const row = queue[next++];
        const result = await processRow(row.id, row.orderIndex ?? 0);
        if (result === "done") doneCount++;
        else failCount++;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, worker)
    );

    setUploading(false);
    if (failCount === 0 && doneCount > 0) {
      toast.success(
        `Uploaded ${doneCount} video${doneCount === 1 ? "" : "s"} — transcoding started`
      );
    } else if (doneCount > 0) {
      toast.error(`${doneCount} uploaded, ${failCount} failed — retry the failed rows`);
    } else if (failCount > 0) {
      toast.error("All uploads failed");
    }
  };

  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;
  const doneCount = rows.filter((r) => r.status === "done").length;
  const oversized = rows.filter((r) => r.file.size >= MAX_VIDEO_BYTES);
  const overallProgress = useMemo(() => {
    if (rows.length === 0) return 0;
    const total = rows.reduce(
      (sum, r) => sum + (r.status === "done" ? 100 : r.status === "uploading" ? r.progress : 0),
      0
    );
    return Math.round(total / rows.length);
  }, [rows]);

  const statusBadge = (s: RowStatus) => {
    const styles: Record<RowStatus, string> = {
      pending: "bg-[var(--border)]/40 text-[var(--muted)]",
      uploading: "bg-[var(--primary)]/10 text-[var(--primary)]",
      saving: "bg-[var(--primary)]/10 text-[var(--primary)]",
      done: "bg-[var(--success)]/10 text-[var(--success)]",
      failed: "bg-[var(--danger)]/10 text-[var(--danger)]",
    };
    return styles[s];
  };

  const rowEditable = (r: BulkRow) =>
    !uploading && (r.status === "pending" || r.status === "failed");

  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-[var(--card)] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Bulk Upload</h1>
            <p className="text-[var(--muted)] mt-1">
              Upload many videos at once — as new movies or as episodes of a series
            </p>
          </div>
        </div>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-6">
          {/* Mode tabs */}
          <div className="inline-flex p-1 rounded-lg bg-[var(--background)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => !uploading && setMode("movies")}
              disabled={uploading}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === "movies"
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              New Movies
            </button>
            <button
              type="button"
              onClick={() => !uploading && setMode("episodes")}
              disabled={uploading}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === "episodes"
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Series Episodes
            </button>
          </div>

          {mode === "movies" ? (
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)]">
              <div>
                <span className="text-sm font-medium">Publish immediately</span>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  Off = created as drafts you can review and publish later
                </p>
              </div>
              <button
                onClick={() => setPublishImmediately(!publishImmediately)}
                disabled={uploading}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  publishImmediately ? "bg-[var(--success)]" : "bg-[var(--border)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    publishImmediately ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-2">Series *</label>
              <select
                value={seriesId}
                onChange={(e) => setSeriesId(e.target.value)}
                disabled={uploading || seriesLoading}
                className="w-full px-4 py-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                <option value="">
                  {seriesLoading ? "Loading series..." : "Select a series"}
                </option>
                {seriesList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} {s.status === "draft" ? "(draft)" : ""}
                  </option>
                ))}
              </select>
              {seriesId && existingVideoCount > 0 && (
                <p className="text-xs text-[var(--muted)] mt-1">
                  This series already has {existingVideoCount} video
                  {existingVideoCount === 1 ? "" : "s"}; new episodes are appended after them.
                </p>
              )}
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (uploading) return;
              const files = Array.from(e.dataTransfer.files);
              addVideoFiles(files);
              addImageFiles(files);
            }}
            className="rounded-lg border-2 border-dashed border-[var(--border)] p-6"
          >
            <div className="flex flex-col items-center text-center">
              <svg className="w-10 h-10 text-[var(--muted)] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-sm text-[var(--muted)]">
                Drag &amp; drop video files here (drop matching images to auto-assign thumbnails)
              </p>
              <div className="flex gap-3 mt-4">
                <label>
                  <span className="inline-flex items-center px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity">
                    Select Videos
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    multiple
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      addVideoFiles(Array.from(e.target.files || []));
                      e.target.value = "";
                    }}
                  />
                </label>
                <label>
                  <span className="inline-flex items-center px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-sm font-medium cursor-pointer hover:border-[var(--primary)] transition-colors">
                    Add Thumbnails
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    disabled={uploading || rows.length === 0}
                    onChange={(e) => {
                      addImageFiles(Array.from(e.target.files || []));
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <p className="text-xs text-[var(--muted)] mt-3">
                Thumbnails match videos by filename: <code>heist.mp4</code> ←{" "}
                <code>heist.jpg</code>. Titles{mode === "episodes" ? " and S01E02 markers" : ""} are
                read from filenames and can be edited below.
              </p>
            </div>
          </div>

          {oversized.length > 0 && (
            <div className="p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-sm text-[var(--danger)]">
              {oversized.length} file{oversized.length === 1 ? " exceeds" : "s exceed"} the 5 GB
              upload limit and will be skipped: {oversized.map((r) => r.file.name).join(", ")}
            </div>
          )}

          {/* Rows */}
          {rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-col gap-3 p-3 rounded-lg bg-[var(--background)] border border-[var(--border)]"
                >
                  <div className="flex items-center gap-3">
                    {/* Thumb */}
                    <label
                      className={`w-20 h-12 rounded-md overflow-hidden bg-[var(--card)] flex-shrink-0 flex items-center justify-center border border-[var(--border)] ${
                        rowEditable(row) ? "cursor-pointer hover:border-[var(--primary)]" : ""
                      } transition-colors`}
                      title="Set thumbnail"
                    >
                      {row.thumbPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.thumbPreview} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <svg className="w-4 h-4 text-[var(--muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                        </svg>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={!rowEditable(row)}
                        onChange={(e) => setRowThumb(row.id, e.target.files?.[0] || null)}
                      />
                    </label>

                    {/* Fields */}
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
                      <div className="min-w-0">
                        <Input
                          value={row.title}
                          onChange={(e) => updateRow(row.id, { title: e.target.value })}
                          disabled={!rowEditable(row)}
                          className="h-8 text-sm"
                          placeholder="Title"
                        />
                        <p className="text-xs text-[var(--muted)] mt-1 truncate">
                          {row.file.name} · {formatSize(row.file.size)}
                        </p>
                      </div>
                      {mode === "episodes" && (
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            min="1"
                            value={row.season}
                            onChange={(e) => updateRow(row.id, { season: e.target.value })}
                            disabled={!rowEditable(row)}
                            className="h-8 w-16 text-sm"
                            placeholder="S"
                          />
                          <Input
                            type="number"
                            min="1"
                            value={row.episode}
                            onChange={(e) => updateRow(row.id, { episode: e.target.value })}
                            disabled={!rowEditable(row)}
                            className="h-8 w-16 text-sm"
                            placeholder="E"
                          />
                        </div>
                      )}
                    </div>

                    {/* Status */}
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap ${statusBadge(row.status)}`}
                    >
                      {row.status === "uploading" ? `${row.progress}%` : row.status}
                    </span>

                    {/* Remove */}
                    {!uploading && row.status !== "uploading" && row.status !== "saving" && (
                      <button
                        onClick={() => removeRow(row.id)}
                        className="p-1.5 rounded-lg hover:bg-[var(--danger)]/10 text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
                        title={row.status === "failed" ? "Remove and clean up" : "Remove from list"}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Per-row progress / error */}
                  {row.status === "uploading" && (
                    <div className="w-full h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-hover)] transition-all duration-300"
                        style={{ width: `${row.progress}%` }}
                      />
                    </div>
                  )}
                  {row.status === "failed" && row.error && (
                    <p className="text-xs text-[var(--danger)]">{row.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          {rows.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-[var(--border)]">
              {uploading && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">
                      Uploading {rows.length - pendingCount - doneCount - failedCount} of{" "}
                      {rows.length}…
                    </span>
                    <span className="font-medium text-[var(--primary)]">{overallProgress}%</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-[var(--border)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-hover)] transition-all duration-300"
                      style={{ width: `${overallProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-sm text-[var(--muted)]">
                  {rows.length} file{rows.length === 1 ? "" : "s"}
                  {doneCount > 0 && ` · ${doneCount} done`}
                  {failedCount > 0 && ` · ${failedCount} failed`}
                </p>
                <div className="flex gap-3">
                  {uploading ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        cancelRef.current = true;
                        toast.success("Finishing current uploads, then stopping");
                      }}
                    >
                      Stop after current
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => setRows([])}
                      >
                        Clear list
                      </Button>
                      <Button
                        onClick={startUpload}
                        disabled={
                          pendingCount + failedCount === 0 ||
                          (mode === "episodes" && !seriesId)
                        }
                      >
                        {failedCount > 0 && pendingCount === 0
                          ? `Retry ${failedCount} failed`
                          : `Upload ${pendingCount + failedCount} video${
                              pendingCount + failedCount === 1 ? "" : "s"
                            }`}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {doneCount > 0 && !uploading && (
                <p className="text-xs text-[var(--muted)]">
                  Uploaded videos show as &ldquo;processing&rdquo; in content until transcoding
                  finishes (a few minutes per video).
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
