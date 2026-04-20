"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { Input, Skeleton } from "@novaflix/ui";
import { GENRES, type Content } from "@novaflix/shared";
import { SubscriptionGate } from "@/components/subscription-gate";
import { track } from "@/lib/pixel";

type ContentType = "all" | "movie" | "series";

interface GeneralSettings {
  requireSubscriptionToBrowse?: boolean;
}

export default function BrowsePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<ContentType>("all");
  const [content, setContent] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings | null>(null);

  // Fetch general settings once
  useEffect(() => {
    async function fetchSettings() {
      try {
        const generalDoc = await getDoc(doc(db(), "settings", "general"));
        if (generalDoc.exists()) {
          setGeneralSettings(generalDoc.data() as GeneralSettings);
        }
      } catch (error) {
        console.error("Failed to fetch general settings:", error);
      }
    }
    fetchSettings();
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fire Meta Pixel Search once the debounced query settles. Skip empty
  // strings so we don't ping fbq while the user is just clearing the box.
  useEffect(() => {
    const trimmed = debouncedSearch.trim();
    if (!trimmed) return;
    track("Search", { search_string: trimmed });
  }, [debouncedSearch]);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    try {
      const constraints: Parameters<typeof query>[1][] = [
        where("status", "==", "published"),
        orderBy("createdAt", "desc"),
      ];

      if (selectedType !== "all") {
        constraints.push(where("type", "==", selectedType));
      }

      if (selectedGenre) {
        constraints.push(where("genre", "array-contains", selectedGenre));
      }

      const q = query(collection(db(), "content"), ...constraints);
      const snap = await getDocs(q);
      let results = snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as Content
      );

      // Client-side search filter (Firestore doesn't support full-text search)
      if (debouncedSearch) {
        const term = debouncedSearch.toLowerCase();
        results = results.filter(
          (item) =>
            item.title.toLowerCase().includes(term) ||
            item.description?.toLowerCase().includes(term)
        );
      }

      setContent(results);
    } catch (error) {
      console.error("Failed to fetch content:", error);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, selectedGenre, selectedType]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  return (
    <div className="min-h-screen pt-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <SubscriptionGate requireGate={generalSettings?.requireSubscriptionToBrowse || false}>
      {/* Search */}
      <div className="mb-6">
        <Input
          type="text"
          placeholder="Search movies, series..."
          value={searchTerm}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setSearchTerm(e.target.value)
          }
          className="w-full max-w-md bg-[var(--card)] border-[var(--border)] text-white placeholder:text-[var(--muted)] px-4 py-3 rounded-lg"
        />
      </div>

      {/* Type Filters */}
      <div className="flex items-center gap-3 mb-4">
        {(["all", "movie", "series"] as ContentType[]).map((type) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`px-5 py-2 text-sm font-medium rounded-full transition-all duration-200 ${
              selectedType === type
                ? "bg-[var(--primary)] text-white ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--background)]"
                : "bg-[var(--card)] text-[var(--muted)] hover:text-white hover:bg-[var(--card-hover)]"
            }`}
          >
            {type === "all" ? "All" : type === "movie" ? "Movies" : "Series"}
          </button>
        ))}
      </div>

      {/* Genre Chips */}
      <div className="flex flex-wrap gap-2 mb-8">
        {GENRES.map((genre) => (
          <button
            key={genre}
            onClick={() =>
              setSelectedGenre(selectedGenre === genre ? null : genre)
            }
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
              selectedGenre === genre
                ? "bg-[var(--primary)] text-white ring-2 ring-[var(--primary)] scale-105"
                : "bg-[var(--card)] text-[var(--muted)] hover:text-white hover:bg-[var(--card-hover)]"
            }`}
          >
            {genre}
          </button>
        ))}
      </div>

      {/* Content Grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="aspect-[2/3] rounded-lg" />
                <Skeleton className="h-4 w-3/4 mt-2" />
                <Skeleton className="h-3 w-1/2 mt-1" />
              </div>
            ))}
          </div>
        ) : content.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <svg
              className="w-20 h-20 text-[var(--muted)] mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
              />
            </svg>
            <h3 className="text-lg font-medium mb-1">No results found</h3>
            <p className="text-sm text-[var(--muted)] max-w-sm">
              Try adjusting your search or filters to find what you are looking for.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {content.map((item) => (
              <Link
                key={item.id}
                href={`/content/${item.id}`}
                className="group"
              >
                <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[var(--card)] shadow-lg shadow-black/20 transition-all duration-300 group-hover:-translate-y-1">
                  <Image
                    src={item.thumbnail}
                    alt={item.title}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <span className="absolute top-2 left-2 px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-[var(--primary)]/90 text-white">
                    {item.type}
                  </span>

                  {/* Play icon overlay on hover */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                    <div className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                      <svg className="w-5 h-5 text-black ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </div>
                <h3 className="mt-2 text-sm font-medium line-clamp-1 group-hover:text-[var(--primary)] transition-colors duration-300">
                  {item.title}
                </h3>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {(item.genre ?? []).slice(0, 2).join(", ")}
                </p>
              </Link>
            ))}
          </div>
        )}
      </SubscriptionGate>
    </div>
  );
}

