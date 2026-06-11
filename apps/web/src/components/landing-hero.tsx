"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, query, where, limit, getDocs } from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { useAuth } from "@/lib/auth-context";

/**
 * Logged-out / non-subscribed landing shown by the home page's SubscriptionGate.
 *
 * - Full-bleed background image from /public (drop the file at
 *   apps/web/public/landing-bg.jpg) with a dark overlay so the CTA stays legible.
 *   A dark gradient shows as a graceful fallback until the image is added.
 * - Subscribe-first CTA over the hero, with sign-in as a quiet secondary link.
 * - A right→left, seamlessly-looping marquee of live published-content posters
 *   along the bottom.
 */
export function LandingHero() {
  const { firebaseUser } = useAuth();
  const [posters, setPosters] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Published content is publicly readable per Firestore rules, so this
        // works even for logged-out visitors. No orderBy → no composite index.
        const snap = await getDocs(
          query(collection(db(), "content"), where("status", "==", "published"), limit(24)),
        );
        const urls = snap.docs
          .map((d) => (d.data() as { thumbnail?: string }).thumbnail)
          .filter((u): u is string => typeof u === "string" && u.length > 0);
        if (!cancelled) setPosters(urls);
      } catch (err) {
        console.error("Failed to load landing posters:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Duplicate the strip so a -50% translate loops seamlessly.
  const strip = posters.length > 0 ? [...posters, ...posters] : [];

  return (
    <div className="relative w-full overflow-hidden min-h-[calc(100svh_-_4rem)]">
      {/* Background image + graceful dark-gradient fallback */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-gradient-to-br from-[#0a0a0a] via-[#16213e] to-[#0a0a0a]"
        style={{ backgroundImage: "url('/landing-bg.jpg')" }}
      />
      {/* Darkening overlays — flat tint + bottom gradient for the poster strip */}
      <div className="absolute inset-0 bg-black/70" />
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--background)] via-black/40 to-black/30" />

      <div className="relative z-10 flex flex-col min-h-[calc(100svh_-_4rem)]">
        {/* Centered subscribe CTA */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <div className="mb-4">
            <span className="text-4xl sm:text-5xl font-bold tracking-tight text-[var(--primary)]">
              Bistar
            </span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold mb-3 max-w-3xl text-shadow">
            Subscribe to unlock content
          </h1>
          <p className="text-[var(--muted)] text-base sm:text-lg mb-8 max-w-xl">
            Get unlimited access to all movies, web series, and exclusive content with a Bistar
            subscription plan.
          </p>
          <Link
            href="/plans"
            className="inline-flex items-center justify-center px-12 py-4 bg-[var(--primary)] text-white font-semibold rounded-lg hover:bg-[var(--primary-hover)] transition-colors text-lg shadow-lg shadow-[var(--primary)]/30"
          >
            Subscribe Now
          </Link>
          {!firebaseUser && (
            <Link
              href="/auth/login"
              className="mt-4 text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              Already have an account?{" "}
              <span className="text-[var(--foreground)] font-medium underline underline-offset-2">
                Sign in
              </span>
            </Link>
          )}
        </div>

        {/* Bottom: right→left looping poster marquee */}
        {strip.length > 0 && (
          <div className="w-full overflow-hidden pb-8 pt-4 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
            <div className="flex w-max gap-3 animate-marquee">
              {strip.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  className="h-40 sm:h-48 aspect-[2/3] object-cover rounded-lg shadow-lg shadow-black/50 flex-shrink-0"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
