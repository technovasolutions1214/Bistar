"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { Skeleton } from "@bistar/ui";
import type { Content } from "@bistar/shared";

const PAGE_SIZE = 12;

/**
 * Vertical grid of published web series. Loads PAGE_SIZE docs at a time and
 * pulls the next page when an invisible sentinel at the bottom scrolls into
 * view. Uses Firestore cursor pagination (startAfter) so each page is stable
 * even if new content is published between fetches.
 */
export function SeriesInfiniteGrid({ title = "Web Series" }: { title?: string }) {
  const [items, setItems] = useState<Content[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // In-flight guard so a double intersection (layout thrashing) doesn't fetch twice.
  const fetchingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback(
    async (after: QueryDocumentSnapshot<DocumentData> | null): Promise<{ docs: Content[]; lastDoc: QueryDocumentSnapshot<DocumentData> | null; done: boolean }> => {
      const constraints: Parameters<typeof query>[1][] = [
        where("status", "==", "published"),
        where("type", "==", "series"),
        orderBy("createdAt", "desc"),
        limit(PAGE_SIZE),
      ];
      if (after) constraints.push(startAfter(after));
      const snap = await getDocs(query(collection(db(), "content"), ...constraints));
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Content);
      const lastDoc = snap.docs[snap.docs.length - 1] ?? null;
      return { docs, lastDoc, done: snap.docs.length < PAGE_SIZE };
    },
    [],
  );

  // Initial fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const { docs, lastDoc, done } = await fetchPage(null);
        if (cancelled) return;
        setItems(docs);
        setCursor(lastDoc);
        setHasMore(!done);
      } catch (err) {
        console.error("SeriesInfiniteGrid: initial fetch failed", err);
        if (!cancelled) setHasMore(false);
      } finally {
        fetchingRef.current = false;
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  // IntersectionObserver on the bottom sentinel. Only arm it once the first
  // page is in — otherwise the sentinel mounts before the grid and fires
  // immediately, leading to a double-fetch on mount.
  useEffect(() => {
    if (loading) return;
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting) return;
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        setLoadingMore(true);
        fetchPage(cursor)
          .then(({ docs, lastDoc, done }) => {
            setItems((prev) => [...prev, ...docs]);
            setCursor(lastDoc ?? cursor);
            if (done) setHasMore(false);
          })
          .catch((err) => {
            console.error("SeriesInfiniteGrid: next page failed", err);
            setHasMore(false);
          })
          .finally(() => {
            fetchingRef.current = false;
            setLoadingMore(false);
          });
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loading, hasMore, cursor, fetchPage]);

  if (loading) {
    return (
      <section className="mb-12 px-4 sm:px-6 lg:px-8">
        <p className="eyebrow">Binge worthy</p>
        <h2 className="text-xl font-semibold mb-4">{title}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-[2/3] rounded-lg" />
              <Skeleton className="h-4 w-3/4 mt-2" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="mb-12 px-4 sm:px-6 lg:px-8">
      <p className="eyebrow">Binge worthy</p>
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {items.map((item) => (
          <Link key={item.id} href={`/content/${item.id}`} className="group/card">
            <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[var(--card)] border border-[var(--border)] shadow-lg shadow-black/30 transition-all duration-300 group-hover/card:-translate-y-1 group-hover/card:border-[var(--gold-3)]/50">
              {item.thumbnail ? (
                <Image
                  src={item.thumbnail}
                  alt={item.title}
                  fill
                  className="object-cover transition-transform duration-300 group-hover/card:scale-105"
                  sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, (max-width: 1280px) 20vw, 16vw"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-[var(--muted)] text-sm">
                  {item.title}
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            </div>
            <p className="text-sm font-medium mt-2 line-clamp-1 group-hover/card:text-[var(--primary)] transition-colors">
              {item.title}
            </p>
          </Link>
        ))}

        {/* Load-more skeletons while the next page is fetching. */}
        {loadingMore &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={`skel-${i}`}>
              <Skeleton className="aspect-[2/3] rounded-lg" />
              <Skeleton className="h-4 w-3/4 mt-2" />
            </div>
          ))}
      </div>

      {/* Sentinel — IntersectionObserver triggers the next page fetch when
       * this element crosses into view (with 400px margin). */}
      {hasMore && <div ref={sentinelRef} className="h-10" aria-hidden="true" />}
    </section>
  );
}
