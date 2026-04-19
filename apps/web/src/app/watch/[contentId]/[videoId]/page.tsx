"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { Loader } from "@novaflix/ui";
import { useAuth } from "@/lib/auth-context";
import type { Content, Video } from "@novaflix/shared";

export default function WatchPage() {
  const params = useParams<{ contentId: string; videoId: string }>();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);
  const { firebaseUser, hasActiveSubscription, loading: authLoading } = useAuth();

  const [content, setContent] = useState<Content | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [allVideos, setAllVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !hasActiveSubscription) {
      router.replace("/plans");
    }
  }, [authLoading, hasActiveSubscription, router]);

  useEffect(() => {
    async function fetchData() {
      if (!params.contentId || !params.videoId) return;
      try {
        // Fetch content
        const contentDoc = await getDoc(doc(db(), "content", params.contentId));
        if (contentDoc.exists()) {
          setContent({ id: contentDoc.id, ...contentDoc.data() } as Content);
        }

        // Fetch current video
        const videoDoc = await getDoc(
          doc(db(), "content", params.contentId, "videos", params.videoId)
        );
        if (videoDoc.exists()) {
          setVideo({ id: videoDoc.id, ...videoDoc.data() } as Video);
        }

        // Fetch all videos for next/prev navigation
        const videosQ = query(
          collection(db(), "content", params.contentId, "videos"),
          orderBy("order", "asc")
        );
        const videosSnap = await getDocs(videosQ);
        setAllVideos(
          videosSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Video)
        );
      } catch (error) {
        console.error("Failed to fetch video:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [params.contentId, params.videoId]);

  // Reset signedUrl when videoId changes to prevent stale URL flash
  useEffect(() => {
    setSignedUrl(null);
  }, [params.videoId]);

  // Resolve the playback URL. When the transcoder has produced an HLS master,
  // use the CDN-hosted videoUrl directly (cache-friendly, supports ABR). Fall
  // back to the gated /api/video/stream signer for the original MP4 while
  // status is "processing" or for legacy content without a transcoded ladder.
  useEffect(() => {
    async function resolvePlaybackUrl() {
      if (!firebaseUser || !params.contentId || !params.videoId || !video) return;

      const hlsMaster =
        video.status === "ready" && video.videoUrl?.endsWith(".m3u8")
          ? video.videoUrl
          : null;

      if (hlsMaster) {
        setSignedUrl(hlsMaster);
        return;
      }

      setUrlLoading(true);
      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await fetch(
          `/api/video/stream?contentId=${encodeURIComponent(params.contentId)}&videoId=${encodeURIComponent(params.videoId)}`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );

        if (res.ok) {
          const data = await res.json();
          setSignedUrl(data.url);
        } else {
          console.error("Failed to fetch signed URL:", res.status);
        }
      } catch (error) {
        console.error("Error fetching signed URL:", error);
      } finally {
        setUrlLoading(false);
      }
    }

    resolvePlaybackUrl();
  }, [firebaseUser, video, params.contentId, params.videoId]);

  // HLS.js setup using signed URL
  useEffect(() => {
    if (!signedUrl || !videoRef.current) return;

    const videoEl = videoRef.current;

    // Destroy previous HLS instance if any
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (signedUrl.includes(".m3u8")) {
      // Dynamic import HLS.js
      import("hls.js").then(({ default: Hls }) => {
        if (Hls.isSupported()) {
          const hls = new Hls();
          hlsRef.current = hls;
          hls.loadSource(signedUrl);
          hls.attachMedia(videoEl);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoEl.play().catch(() => {});
          });
        } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
          videoEl.src = signedUrl;
          videoEl.addEventListener("loadedmetadata", () => {
            videoEl.play().catch(() => {});
          });
        }
      });
    } else {
      videoEl.src = signedUrl;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [signedUrl]);

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <Loader />
      </div>
    );
  }

  if (!hasActiveSubscription) {
    return null; // Redirecting to /plans
  }

  if (!video || !content) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h2 className="text-xl font-semibold mb-2">Video not found</h2>
        <Link href="/" className="text-[var(--primary)] hover:underline">
          Go back home
        </Link>
      </div>
    );
  }

  const currentIndex = allVideos.findIndex((v) => v.id === video.id);
  const prevVideo = currentIndex > 0 ? allVideos[currentIndex - 1] : null;
  const nextVideo =
    currentIndex < allVideos.length - 1 ? allVideos[currentIndex + 1] : null;

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
  }

  return (
    <div className="min-h-screen bg-black pt-16">
      {/* Video Player */}
      <div className="w-full max-w-6xl mx-auto aspect-video bg-black">
        {urlLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader />
          </div>
        ) : (
          <video
            ref={videoRef}
            className="w-full h-full"
            controls
            autoPlay
            playsInline
            poster={video.thumbnailUrl || content.banner || content.thumbnail}
          />
        )}
      </div>

      {/* Video Info */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">{video.title}</h1>
            {content.type === "series" && video.season && video.episode && (
              <p className="text-sm text-[var(--muted)] mt-1">
                Season {video.season}, Episode {video.episode}
              </p>
            )}
          </div>
          <span className="text-sm text-[var(--muted)] flex-shrink-0">
            {formatDuration(video.duration)}
          </span>
        </div>

        {video.description && (
          <p className="text-sm text-[var(--muted)] mb-6">{video.description}</p>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between gap-4 border-t border-[var(--border)] pt-4">
          <Link
            href={`/content/${content.id}`}
            className="text-sm text-[var(--muted)] hover:text-white transition-colors flex items-center gap-1"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to {content.title}
          </Link>

          {content.type === "series" && (
            <div className="flex items-center gap-3">
              {prevVideo && (
                <Link
                  href={`/watch/${content.id}/${prevVideo.id}`}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--card)] text-white rounded-lg hover:bg-[var(--card-hover)] transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                  Previous
                </Link>
              )}
              {nextVideo && (
                <Link
                  href={`/watch/${content.id}/${nextVideo.id}`}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
                >
                  Next
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
