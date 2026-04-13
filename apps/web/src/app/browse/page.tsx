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
} from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { Input, Loader } from "@novaflix/ui";
import { GENRES, type Content } from "@novaflix/shared";

type ContentType = "all" | "movie" | "series";

export default function BrowsePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<ContentType>("all");
  const [content, setContent] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

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
            item.description.toLowerCase().includes(term)
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
      <div className="flex items-center gap-2 mb-4">
        {(["all", "movie", "series"] as ContentType[]).map((type) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
              selectedType === type
                ? "bg-[var(--primary)] text-white"
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
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              selectedGenre === genre
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--card)] text-[var(--muted)] hover:text-white hover:bg-[var(--card-hover)]"
            }`}
          >
            {genre}
          </button>
        ))}
      </div>

      {/* Content Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader />
        </div>
      ) : content.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg
            className="w-16 h-16 text-[var(--muted)] mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <h3 className="text-lg font-medium mb-1">No results found</h3>
          <p className="text-sm text-[var(--muted)]">
            Try adjusting your search or filters
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
              <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[var(--card)]">
                <Image
                  src={item.thumbnail}
                  alt={item.title}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="absolute top-2 left-2 px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-[var(--primary)]/90 text-white">
                  {item.type}
                </span>
              </div>
              <h3 className="mt-2 text-sm font-medium line-clamp-1 group-hover:text-[var(--primary)] transition-colors">
                {item.title}
              </h3>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {item.genre.slice(0, 2).join(", ")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
