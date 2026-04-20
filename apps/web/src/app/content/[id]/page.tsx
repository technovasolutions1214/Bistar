"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { Loader, Button } from "@novaflix/ui";
import { useAuth } from "@/lib/auth-context";
import { track } from "@/lib/pixel";
import type { Content, Video } from "@novaflix/shared";

interface GeneralSettings {
  requireSubscriptionToBrowse?: boolean;
}

export default function ContentDetailPage() {
  const params = useParams<{ id: string }>();
  const { hasActiveSubscription, loading: authLoading } = useAuth();
  const [content, setContent] = useState<Content | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings | null>(null);

  useEffect(() => {
    async function fetchContent() {
      if (!params.id) return;
      try {
        const contentDoc = await getDoc(doc(db(), "content", params.id));
        if (contentDoc.exists()) {
          setContent({ id: contentDoc.id, ...contentDoc.data() } as Content);
        }

        // Fetch videos subcollection
        const videosQ = query(
          collection(db(), "content", params.id, "videos"),
          orderBy("order", "asc")
        );
        const videosSnap = await getDocs(videosQ);
        setVideos(
          videosSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Video)
        );

        // Fetch general settings
        const generalDoc = await getDoc(doc(db(), "settings", "general"));
        if (generalDoc.exists()) {
          setGeneralSettings(generalDoc.data() as GeneralSettings);
        }
      } catch (error) {
        console.error("Failed to fetch content:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchContent();
  }, [params.id]);

  // Fire a Meta Pixel ViewContent event once we know what's loaded.
  useEffect(() => {
    if (!content) return;
    track("ViewContent", {
      content_ids: [content.id],
      content_type: "video",
      content_name: content.title,
      content_category: content.type,
    });
  }, [content]);

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader />
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h2 className="text-xl font-semibold mb-2">Content not found</h2>
        <Link href="/" className="text-[var(--primary)] hover:underline">
          Go back home
        </Link>
      </div>
    );
  }

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
  }

  return (
    <div className="min-h-screen">
      {/* Banner */}
      <div className="relative h-[50vh] sm:h-[60vh] w-full">
        <Image
          src={content.banner || content.thumbnail}
          alt={content.title}
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--background)]/80 to-transparent" />
      </div>

      {/* Content Info */}
      <div className="relative -mt-40 z-10 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
        <h1
          className="text-3xl sm:text-4xl font-bold mb-3"
          style={{ textShadow: '0 2px 16px rgba(0,0,0,0.8)' }}
        >
          {content.title}
        </h1>

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="px-2.5 py-1 text-xs font-semibold uppercase rounded bg-[var(--primary)] text-white">
            {content.type}
          </span>
          {content.rating && (
            <span className="flex items-center gap-1 text-sm text-yellow-400">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              {content.rating.toFixed(1)}
            </span>
          )}
          {(content.genre ?? []).map((g) => (
            <span
              key={g}
              className="px-2.5 py-1 text-xs rounded-full bg-[var(--card)] text-[var(--muted)] border border-[var(--border)]"
            >
              {g}
            </span>
          ))}
        </div>

        <p
          className="text-[var(--muted)] max-w-2xl mb-8 leading-relaxed"
          style={{ textShadow: '0 1px 8px rgba(0,0,0,0.5)' }}
        >
          {content.description}
        </p>

        {/* Subscription Prompt */}
        {!hasActiveSubscription && (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 mb-8">
            <h3 className="text-lg font-semibold mb-2">
              Subscribe to watch
            </h3>
            <p className="text-sm text-[var(--muted)] mb-4">
              You need an active subscription to stream this content.
            </p>
            <Link href="/plans">
              <Button className="bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white px-6 py-2.5 rounded-lg font-medium">
                View Plans
              </Button>
            </Link>
          </div>
        )}

        {/* Videos List */}
        {videos.length > 0 && (
          <div className="mb-12">
            <h2 className="text-xl font-semibold mb-4">
              {content.type === "series" ? "Episodes" : "Videos"}
            </h2>
            <div className="space-y-3">
              {videos.map((video, index) => (
                <div
                  key={video.id}
                  className="flex items-center gap-4 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 hover:bg-[var(--card-hover)] hover:border-[var(--card-hover)] hover:shadow-lg shadow-black/20 transition-all duration-200 group"
                >
                  {/* Thumbnail or Index */}
                  <div className="relative w-16 h-16 sm:w-24 sm:h-16 flex-shrink-0 rounded-lg overflow-hidden bg-[var(--background)]">
                    {video.thumbnailUrl ? (
                      <Image
                        src={video.thumbnailUrl}
                        alt={video.title}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-lg font-bold text-[var(--muted)]">
                        {index + 1}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm sm:text-base line-clamp-1 group-hover:text-white transition-colors">
                      {content.type === "series" && video.season && video.episode
                        ? `S${video.season} E${video.episode} - ${video.title}`
                        : video.title}
                    </h3>
                    {video.description && (
                      <p className="text-xs text-[var(--muted)] line-clamp-1 mt-0.5">
                        {video.description}
                      </p>
                    )}
                    {video.duration > 0 && (
                      <span className="text-xs text-[var(--muted)]">
                        {formatDuration(video.duration)}
                      </span>
                    )}
                  </div>

                  {/* Play Button */}
                  {hasActiveSubscription ? (
                    <Link
                      href={`/watch/${content.id}/${video.id}`}
                      className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] hover:scale-110 transition-all duration-200"
                    >
                      <svg
                        className="w-5 h-5 ml-0.5"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </Link>
                  ) : (
                    <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-[var(--muted)]/30 text-[var(--muted)]">
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
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
