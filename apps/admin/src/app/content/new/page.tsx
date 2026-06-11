"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "@bistar/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Button, Input, useToast } from "@bistar/ui";
import { GENRES } from "@bistar/shared";

export default function NewContentPage() {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"movie" | "series">("movie");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [rating, setRating] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [isTrending, setIsTrending] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);

  // File uploads
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState("");
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState("");

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
      let thumbnailUrl = "";
      let bannerUrl = "";

      if (thumbnailFile) {
        // Writes must land under /thumbnails/** per storage.rules — the
        // previous /content/thumbnails/** path was rejected by rules and
        // showed only a generic save-failure toast.
        thumbnailUrl = await uploadFile(
          thumbnailFile,
          `thumbnails/content/${Date.now()}_${thumbnailFile.name}`
        );
      }
      if (bannerFile) {
        bannerUrl = await uploadFile(
          bannerFile,
          `banners/content/${Date.now()}_${bannerFile.name}`
        );
      }

      await addDoc(collection(db(), "content"), {
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
        releaseDate: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast.success("Content created successfully");
      router.push("/content");
    } catch (err) {
      console.error("Failed to create content:", err);
      toast.error("Failed to create content");
    } finally {
      setSaving(false);
    }
  };

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
            <h1 className="text-2xl font-bold text-white">New Content</h1>
            <p className="text-[var(--muted)] mt-1">Add a new movie or series</p>
          </div>
        </div>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium mb-2">Title *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter content title"
            />
          </div>

          {/* Description */}
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

          {/* Type & Rating */}
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
              <Input
                type="number"
                min="0"
                max="10"
                step="0.1"
                value={rating}
                onChange={(e) => setRating(e.target.value)}
                placeholder="0.0 - 10.0"
              />
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

          {/* Thumbnail Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">Thumbnail</label>
            <div className="flex items-start gap-4">
              {thumbnailPreview && (
                <img
                  src={thumbnailPreview}
                  alt="Thumbnail preview"
                  className="w-24 h-16 rounded-lg object-cover"
                />
              )}
              <label className="flex-1 flex flex-col items-center justify-center px-4 py-6 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--primary)] cursor-pointer transition-colors">
                <svg className="w-8 h-8 text-[var(--muted)] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <span className="text-sm text-[var(--muted)]">Click to upload thumbnail</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setThumbnailFile(file);
                      handleFilePreview(file, setThumbnailPreview);
                    }
                  }}
                />
              </label>
            </div>
          </div>

          {/* Banner Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">Banner Image</label>
            <div className="space-y-3">
              {bannerPreview && (
                <img
                  src={bannerPreview}
                  alt="Banner preview"
                  className="w-full h-32 rounded-lg object-cover"
                />
              )}
              <label className="flex flex-col items-center justify-center px-4 py-6 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--primary)] cursor-pointer transition-colors">
                <svg className="w-8 h-8 text-[var(--muted)] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <span className="text-sm text-[var(--muted)]">Click to upload banner image</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setBannerFile(file);
                      handleFilePreview(file, setBannerPreview);
                    }
                  }}
                />
              </label>
            </div>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Status */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)]">
              <span className="text-sm font-medium">Published</span>
              <button
                onClick={() => setStatus(status === "published" ? "draft" : "published")}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  status === "published" ? "bg-[var(--success)]" : "bg-[var(--border)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    status === "published" ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>

            {/* Trending */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)]">
              <span className="text-sm font-medium">Trending</span>
              <button
                onClick={() => setIsTrending(!isTrending)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  isTrending ? "bg-[var(--success)]" : "bg-[var(--border)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    isTrending ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>

            {/* Featured */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)]">
              <span className="text-sm font-medium">Featured</span>
              <button
                onClick={() => setIsFeatured(!isFeatured)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  isFeatured ? "bg-[var(--success)]" : "bg-[var(--border)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    isFeatured ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border)]">
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button loading={saving} onClick={handleSave} disabled={!title.trim()}>
              Create Content
            </Button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
