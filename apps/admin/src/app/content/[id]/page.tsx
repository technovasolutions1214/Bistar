"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "@novaflix/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Button, Input, Loader, Modal, useToast } from "@novaflix/ui";
import { GENRES, type Content, type Video } from "@novaflix/shared";

export default function EditContentPage() {
  const router = useRouter();
  const params = useParams();
  const contentId = params.id as string;
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Content form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"movie" | "series">("movie");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [rating, setRating] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [isTrending, setIsTrending] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);
  const [existingThumbnail, setExistingThumbnail] = useState("");
  const [existingBanner, setExistingBanner] = useState("");
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState("");
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState("");

  // Videos
  const [videos, setVideos] = useState<Video[]>([]);
  const [showVideoUpload, setShowVideoUpload] = useState(false);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoDescription, setVideoDescription] = useState("");
  const [videoSeason, setVideoSeason] = useState("");
  const [videoEpisode, setVideoEpisode] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const [editingTitleDraft, setEditingTitleDraft] = useState("");
  const [savingVideoTitle, setSavingVideoTitle] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const contentSnap = await getDoc(doc(db(), "content", contentId));

      if (!contentSnap.exists()) {
        router.replace("/content");
        return;
      }

      const data = contentSnap.data() as Content;
      setTitle(data.title);
      setDescription(data.description || "");
      setType(data.type);
      setSelectedGenres(data.genre || []);
      setRating(data.rating?.toString() || "");
      setStatus(data.status);
      setIsTrending(data.isTrending);
      setIsFeatured(data.isFeatured);
      setExistingThumbnail(data.thumbnail || "");
      setExistingBanner(data.banner || "");

      // Fetch videos
      const videosQuery = query(
        collection(db(), "content", contentId, "videos"),
        orderBy("order", "asc")
      );
      const videosSnap = await getDocs(videosQuery);
      setVideos(
        videosSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Video))
      );
    } catch (err) {
      console.error("Failed to fetch content:", err);
    } finally {
      setLoading(false);
    }
  }, [contentId, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFilePreview = (
    file: File,
    setPreview: React.Dispatch<React.SetStateAction<string>>
  ) => {
    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const uploadFile = async (file: File, path: string): Promise<string> => {
    const storageRef = ref(storage(),path);
    const task = uploadBytesResumable(storageRef, file);
    return new Promise((resolve, reject) => {
      task.on("state_changed", null, reject, async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve(url);
      });
    });
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      let thumbnailUrl = existingThumbnail;
      let bannerUrl = existingBanner;

      if (thumbnailFile) {
        thumbnailUrl = await uploadFile(
          thumbnailFile,
          `content/thumbnails/${Date.now()}_${thumbnailFile.name}`
        );
      }
      if (bannerFile) {
        bannerUrl = await uploadFile(
          bannerFile,
          `content/banners/${Date.now()}_${bannerFile.name}`
        );
      }

      await updateDoc(doc(db(), "content", contentId), {
        title: title.trim(),
        description: description.trim(),
        type,
        genre: selectedGenres,
        rating: rating ? parseFloat(rating) : null,
        thumbnail: thumbnailUrl,
        banner: bannerUrl,
        status,
        isTrending,
        isFeatured,
        updatedAt: serverTimestamp(),
      });

      toast.success("Content saved successfully");
      router.push("/content");
    } catch (err) {
      console.error("Failed to update content:", err);
      toast.error("Failed to save content");
    } finally {
      setSaving(false);
    }
  };

  const handleVideoUpload = async () => {
    if (!videoFile || !videoTitle.trim()) return;
    setUploading(true);
    setUploadProgress(0);

    try {
      const videoDocRef = doc(collection(db(), "content", contentId, "videos"));
      const videoId = videoDocRef.id;
      const storagePath = `videos/${contentId}/${videoId}/original/${videoFile.name}`;
      const storageRef = ref(storage(),storagePath);
      const task = uploadBytesResumable(storageRef, videoFile);

      task.on(
        "state_changed",
        (snapshot) => {
          setUploadProgress(
            Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          );
        },
        (error) => {
          console.error("Upload failed:", error);
          toast.error("Video upload failed");
          setUploading(false);
        },
        async () => {
          const url = await getDownloadURL(task.snapshot.ref);
          await setDoc(
            videoDocRef,
            {
              contentId,
              title: videoTitle.trim(),
              description: videoDescription.trim(),
              season: videoSeason ? parseInt(videoSeason) : null,
              episode: videoEpisode ? parseInt(videoEpisode) : null,
              videoUrl: url,
              storageRef: storagePath,
              duration: 0,
              status: "processing",
              order: videos.length,
              createdAt: serverTimestamp(),
            },
            { merge: true }
          );

          setVideos((prev) => [
            ...prev,
            {
              id: videoId,
              contentId,
              title: videoTitle.trim(),
              description: videoDescription.trim(),
              season: videoSeason ? parseInt(videoSeason) : undefined,
              episode: videoEpisode ? parseInt(videoEpisode) : undefined,
              videoUrl: url,
              storageRef: storagePath,
              duration: 0,
              status: "processing",
              order: videos.length,
              createdAt: serverTimestamp(),
            } as unknown as Video,
          ]);

          // Reset form
          setVideoTitle("");
          setVideoDescription("");
          setVideoSeason("");
          setVideoEpisode("");
          setVideoFile(null);
          setUploadProgress(0);
          setUploading(false);
          setShowVideoUpload(false);
          toast.success("Video uploaded successfully");
        }
      );
    } catch (err) {
      console.error("Video upload failed:", err);
      toast.error("Video upload failed");
      setUploading(false);
    }
  };

  const moveVideo = async (index: number, direction: "up" | "down") => {
    const newVideos = [...videos];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newVideos.length) return;

    [newVideos[index], newVideos[swapIndex]] = [newVideos[swapIndex], newVideos[index]];

    try {
      // Update order field
      const batch = writeBatch(db());
      newVideos.forEach((v, i) => {
        batch.update(doc(db(), "content", contentId, "videos", v.id), { order: i });
      });
      await batch.commit();
      setVideos(newVideos);
    } catch (err) {
      console.error("Failed to reorder videos:", err);
      toast.error("Failed to reorder videos");
    }
  };

  const deleteVideo = async (videoId: string) => {
    try {
      await deleteDoc(doc(db(), "content", contentId, "videos", videoId));
      setVideos((prev) => prev.filter((v) => v.id !== videoId));
      toast.success("Video deleted");
    } catch (err) {
      console.error("Failed to delete video:", err);
      toast.error("Failed to delete video");
    }
  };

  const startEditingVideoTitle = (video: Video) => {
    setEditingVideoId(video.id);
    setEditingTitleDraft(video.title);
  };

  const cancelEditingVideoTitle = () => {
    setEditingVideoId(null);
    setEditingTitleDraft("");
  };

  const saveVideoTitle = async () => {
    if (!editingVideoId) return;
    const trimmed = editingTitleDraft.trim();
    if (!trimmed) {
      toast.error("Title cannot be empty");
      return;
    }
    const original = videos.find((v) => v.id === editingVideoId);
    if (original && original.title === trimmed) {
      cancelEditingVideoTitle();
      return;
    }
    setSavingVideoTitle(true);
    try {
      await updateDoc(doc(db(), "content", contentId, "videos", editingVideoId), {
        title: trimmed,
      });
      setVideos((prev) =>
        prev.map((v) => (v.id === editingVideoId ? { ...v, title: trimmed } : v))
      );
      toast.success("Video title updated");
      cancelEditingVideoTitle();
    } catch (err) {
      console.error("Failed to update video title:", err);
      toast.error("Failed to update title");
    } finally {
      setSavingVideoTitle(false);
    }
  };

  const statusBadge = (s: Video["status"]) => {
    const styles = {
      processing: "bg-[var(--warning)]/10 text-[var(--warning)]",
      ready: "bg-[var(--success)]/10 text-[var(--success)]",
      failed: "bg-[var(--danger)]/10 text-[var(--danger)]",
    };
    return styles[s] || styles.processing;
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-20">
          <Loader />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
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
            <h1 className="text-2xl font-bold text-white">Edit Content</h1>
            <p className="text-[var(--muted)] mt-1">Update content details and manage videos</p>
          </div>
        </div>

        {/* Content Form */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Title *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter content title" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description..."
              rows={4}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Type *</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "movie" | "series")}
                className="w-full px-4 py-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                <option value="movie">Movie</option>
                <option value="series">Series</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Rating</label>
              <Input type="number" min="0" max="10" step="0.1" value={rating} onChange={(e) => setRating(e.target.value)} placeholder="0.0 - 10.0" />
            </div>
          </div>

          {/* Genres */}
          <div>
            <label className="block text-sm font-medium mb-2">Genres</label>
            <div className="flex flex-wrap gap-2">
              {GENRES.map((genre) => (
                <button
                  key={genre}
                  onClick={() => toggleGenre(genre)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    selectedGenres.includes(genre)
                      ? "bg-[var(--primary)] text-white"
                      : "bg-[var(--background)] text-[var(--muted)] hover:text-[var(--foreground)] border border-[var(--border)]"
                  }`}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>

          {/* Thumbnail */}
          <div>
            <label className="block text-sm font-medium mb-2">Thumbnail</label>
            <div className="flex items-start gap-4">
              {(thumbnailPreview || existingThumbnail) && (
                <img src={thumbnailPreview || existingThumbnail} alt="Thumbnail" className="w-24 h-16 rounded-lg object-cover" />
              )}
              <label className="flex-1 flex flex-col items-center justify-center px-4 py-6 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--primary)] cursor-pointer transition-colors">
                <svg className="w-8 h-8 text-[var(--muted)] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <span className="text-sm text-[var(--muted)]">Change thumbnail</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) { setThumbnailFile(file); handleFilePreview(file, setThumbnailPreview); }
                }} />
              </label>
            </div>
          </div>

          {/* Banner */}
          <div>
            <label className="block text-sm font-medium mb-2">Banner Image</label>
            {(bannerPreview || existingBanner) && (
              <img src={bannerPreview || existingBanner} alt="Banner" className="w-full h-32 rounded-lg object-cover mb-3" />
            )}
            <label className="flex flex-col items-center justify-center px-4 py-6 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--primary)] cursor-pointer transition-colors">
              <svg className="w-8 h-8 text-[var(--muted)] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span className="text-sm text-[var(--muted)]">Change banner image</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) { setBannerFile(file); handleFilePreview(file, setBannerPreview); }
              }} />
            </label>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)]">
              <span className="text-sm font-medium">Published</span>
              <button onClick={() => setStatus(status === "published" ? "draft" : "published")} className={`relative w-11 h-6 rounded-full transition-colors ${status === "published" ? "bg-[var(--success)]" : "bg-[var(--border)]"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${status === "published" ? "translate-x-5" : ""}`} />
              </button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)]">
              <span className="text-sm font-medium">Trending</span>
              <button onClick={() => setIsTrending(!isTrending)} className={`relative w-11 h-6 rounded-full transition-colors ${isTrending ? "bg-[var(--success)]" : "bg-[var(--border)]"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${isTrending ? "translate-x-5" : ""}`} />
              </button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)]">
              <span className="text-sm font-medium">Featured</span>
              <button onClick={() => setIsFeatured(!isFeatured)} className={`relative w-11 h-6 rounded-full transition-colors ${isFeatured ? "bg-[var(--success)]" : "bg-[var(--border)]"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${isFeatured ? "translate-x-5" : ""}`} />
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border)]">
            <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
            <Button loading={saving} onClick={handleSave} disabled={!title.trim()}>Save Changes</Button>
          </div>
        </div>

        {/* Videos Section */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Videos</h2>
            <Button size="sm" onClick={() => setShowVideoUpload(true)}>
              <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Upload Video
            </Button>
          </div>

          {videos.length === 0 ? (
            <p className="text-[var(--muted)] text-sm py-6 text-center">No videos yet. Upload your first video.</p>
          ) : (
            <div className="space-y-2">
              {videos.map((video, index) => (
                <div key={video.id} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--background)] border border-[var(--border)]">
                  {/* Reorder */}
                  <div className="flex flex-col gap-1">
                    <button onClick={() => moveVideo(index, "up")} disabled={index === 0} className="p-0.5 rounded hover:bg-[var(--card)] disabled:opacity-30">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                      </svg>
                    </button>
                    <button onClick={() => moveVideo(index, "down")} disabled={index === videos.length - 1} className="p-0.5 rounded hover:bg-[var(--card)] disabled:opacity-30">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    {editingVideoId === video.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          autoFocus
                          value={editingTitleDraft}
                          onChange={(e) => setEditingTitleDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveVideoTitle();
                            else if (e.key === "Escape") cancelEditingVideoTitle();
                          }}
                          className="h-8 text-sm"
                        />
                        <Button size="sm" onClick={saveVideoTitle} disabled={savingVideoTitle}>
                          {savingVideoTitle ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={cancelEditingVideoTitle}
                          disabled={savingVideoTitle}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium truncate">{video.title}</p>
                          <button
                            onClick={() => startEditingVideoTitle(video)}
                            className="p-1 rounded hover:bg-[var(--card)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                            aria-label="Edit title"
                            title="Edit title"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zM19.5 19.5h-15" />
                            </svg>
                          </button>
                        </div>
                        <p className="text-xs text-[var(--muted)]">
                          {video.season != null && `S${video.season}`}
                          {video.episode != null && `E${video.episode}`}
                          {video.duration > 0 && ` - ${Math.floor(video.duration / 60)}m`}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Status */}
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 ${statusBadge(video.status)}`}>
                    {video.status === "processing" && (
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    )}
                    {video.status === "ready" && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                    {video.status === "failed" && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    {video.status}
                  </span>

                  {/* Delete */}
                  <button onClick={() => deleteVideo(video.id)} className="p-1.5 rounded-lg hover:bg-[var(--danger)]/10 text-[var(--muted)] hover:text-[var(--danger)] transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Video Upload Modal */}
      <Modal isOpen={showVideoUpload} onClose={() => setShowVideoUpload(false)} title="Upload Video" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Title *</label>
            <Input value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)} placeholder="Video title" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <textarea
              value={videoDescription}
              onChange={(e) => setVideoDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-none"
            />
          </div>
          {type === "series" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Season</label>
                <Input type="number" min="1" value={videoSeason} onChange={(e) => setVideoSeason(e.target.value)} placeholder="1" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Episode</label>
                <Input type="number" min="1" value={videoEpisode} onChange={(e) => setVideoEpisode(e.target.value)} placeholder="1" />
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-2">Video File *</label>
            <label className="flex flex-col items-center justify-center px-4 py-8 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--primary)] cursor-pointer transition-colors">
              {videoFile ? (
                <div className="text-center">
                  <p className="text-sm font-medium">{videoFile.name}</p>
                  <p className="text-xs text-[var(--muted)] mt-1">{(videoFile.size / (1024 * 1024)).toFixed(1)} MB</p>
                </div>
              ) : (
                <>
                  <svg className="w-10 h-10 text-[var(--muted)] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <span className="text-sm text-[var(--muted)]">Click to select a video file</span>
                </>
              )}
              <input type="file" accept="video/*" className="hidden" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
            </label>
          </div>

          {/* Progress bar */}
          {uploading && (
            <div className="space-y-2 p-4 rounded-lg bg-[var(--background)] border border-[var(--border)]">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--muted)] flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin text-[var(--primary)]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Uploading...
                </span>
                <span className="font-medium text-[var(--primary)]">{uploadProgress}%</span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-[var(--border)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-hover)] transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowVideoUpload(false)} disabled={uploading}>Cancel</Button>
            <Button loading={uploading} onClick={handleVideoUpload} disabled={!videoFile || !videoTitle.trim()}>Upload</Button>
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
