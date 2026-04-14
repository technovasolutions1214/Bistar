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
import { Skeleton } from "@novaflix/ui";
import type { Content, SiteSettings } from "@novaflix/shared";
import { ContentCarousel } from "@/components/content-carousel";
import { SubscriptionGate } from "@/components/subscription-gate";

interface GeneralSettings {
  requireSubscriptionToBrowse?: boolean;
}

export default function HomePage() {
  const [hero, setHero] = useState<Content | null>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings | null>(null);
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

        // Fetch general settings for subscription gate
        const generalDoc = await getDoc(doc(db(), "settings", "general"));
        if (generalDoc.exists()) {
          setGeneralSettings(generalDoc.data() as GeneralSettings);
        }

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
      <div className="min-h-screen pt-16">
        {/* Hero Skeleton */}
        <div className="relative h-[70vh] sm:h-[80vh] w-full">
          <Skeleton className="absolute inset-0 rounded-none" />
          <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-10 lg:p-16 max-w-3xl space-y-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <div className="flex gap-3 pt-2">
              <Skeleton className="h-12 w-28 rounded-lg" />
              <Skeleton className="h-12 w-32 rounded-lg" />
            </div>
          </div>
        </div>
        {/* Carousel Skeletons */}
        {[1, 2, 3].map((i) => (
          <div key={i} className="mb-10 px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-6 w-40 mb-4" />
            <div className="flex gap-3">
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} className="flex-shrink-0 w-[160px] sm:w-[200px] md:w-[240px]">
                  <Skeleton className="aspect-[2/3] rounded-lg" />
                  <Skeleton className="h-4 w-3/4 mt-2" />
                </div>
              ))}
            </div>
          </div>
        ))}
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
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--background)]/80 to-transparent" />

          <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-10 lg:p-16 max-w-3xl animate-fade-in">
            {/* Genre tags and rating */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {hero.genre?.slice(0, 3).map((g) => (
                <span
                  key={g}
                  className="px-2.5 py-1 text-[10px] font-semibold uppercase rounded-full bg-white/10 backdrop-blur-sm text-white/90 border border-white/10"
                >
                  {g}
                </span>
              ))}
              {hero.rating && (
                <span className="flex items-center gap-1 text-sm text-yellow-400 ml-1">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  {hero.rating.toFixed(1)}
                </span>
              )}
            </div>

            <h1
              className="text-3xl sm:text-5xl font-bold mb-3 leading-tight"
              style={{ textShadow: '0 2px 16px rgba(0,0,0,0.8)' }}
            >
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
      <SubscriptionGate requireGate={generalSettings?.requireSubscriptionToBrowse || false}>
        <div className="py-8 space-y-2">
          <ContentCarousel title="Trending Now" items={trending} />
          <ContentCarousel title="Latest Releases" items={latest} />
          <ContentCarousel title="Web Series" items={series} />
        </div>
      </SubscriptionGate>
    </div>
  );
}
