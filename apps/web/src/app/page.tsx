"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { Loader } from "@novaflix/ui";
import type { Content, SiteSettings } from "@novaflix/shared";
import { ContentCarousel } from "@/components/content-carousel";

export default function HomePage() {
  const [hero, setHero] = useState<Content | null>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [trending, setTrending] = useState<Content[]>([]);
  const [latest, setLatest] = useState<Content[]>([]);
  const [series, setSeries] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch site settings for hero
        const settingsDoc = await getDoc(doc(db(),"settings", "site"));
        const settings = settingsDoc.exists()
          ? (settingsDoc.data() as SiteSettings)
          : null;
        setSiteSettings(settings);

        // Fetch hero content
        if (settings?.heroContentId) {
          const heroDoc = await getDoc(
            doc(db(),"content", settings.heroContentId)
          );
          if (heroDoc.exists()) {
            setHero({ id: heroDoc.id, ...heroDoc.data() } as Content);
          }
        } else {
          // Fallback: use first featured content
          const featuredQ = query(
            collection(db(),"content"),
            where("status", "==", "published"),
            where("isFeatured", "==", true),
            limit(1)
          );
          const featuredSnap = await getDocs(featuredQ);
          if (!featuredSnap.empty) {
            const d = featuredSnap.docs[0];
            setHero({ id: d.id, ...d.data() } as Content);
          }
        }

        // Fetch trending
        const trendingQ = query(
          collection(db(),"content"),
          where("status", "==", "published"),
          where("isTrending", "==", true),
          orderBy("createdAt", "desc"),
          limit(20)
        );
        const trendingSnap = await getDocs(trendingQ);
        setTrending(
          trendingSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Content)
        );

        // Fetch latest releases
        const latestQ = query(
          collection(db(),"content"),
          where("status", "==", "published"),
          orderBy("createdAt", "desc"),
          limit(20)
        );
        const latestSnap = await getDocs(latestQ);
        setLatest(
          latestSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Content)
        );

        // Fetch web series
        const seriesQ = query(
          collection(db(),"content"),
          where("status", "==", "published"),
          where("type", "==", "series"),
          orderBy("createdAt", "desc"),
          limit(20)
        );
        const seriesSnap = await getDocs(seriesQ);
        setSeries(
          seriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Content)
        );
      } catch (error) {
        console.error("Failed to fetch homepage data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader />
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-16">
      {/* Hero Banner */}
      {hero && (
        <section className="relative h-[70vh] sm:h-[80vh] w-full">
          <Image
            src={hero.banner || hero.thumbnail}
            alt={hero.title}
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--background)]/80 to-transparent" />

          <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-10 lg:p-16 max-w-3xl">
            <h1 className="text-3xl sm:text-5xl font-bold mb-3 leading-tight">
              {siteSettings?.heroTitle || hero.title}
            </h1>
            <p className="text-sm sm:text-base text-[var(--muted)] mb-6 line-clamp-3">
              {siteSettings?.heroDescription || hero.description}
            </p>
            <div className="flex items-center gap-3">
              <Link
                href={`/content/${hero.id}`}
                className="flex items-center gap-2 px-6 py-3 bg-[var(--primary)] text-white font-semibold rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
                Play
              </Link>
              <Link
                href={`/content/${hero.id}`}
                className="flex items-center gap-2 px-6 py-3 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-lg hover:bg-white/20 transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                More Info
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Content Carousels */}
      <div className="py-8 space-y-2">
        <ContentCarousel title="Trending Now" items={trending} />
        <ContentCarousel title="Latest Releases" items={latest} />
        <ContentCarousel title="Web Series" items={series} />
      </div>
    </div>
  );
}
