"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { collection, query, where, limit, getDocs } from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { useAuth } from "@/lib/auth-context";
import { HomeQuickCheckout } from "@/components/home-quick-checkout";

/**
 * Logged-out / non-subscribed landing shown by the home page's SubscriptionGate.
 *
 * Premium-dark / cinematic: warm near-black canvas, gold gradient wordmark,
 * a glowing gold "Subscribe" CTA, and a right→left looping poster marquee with
 * a gold-tinted edge mask. Background image is optional (drop one at
 * apps/web/public/landing-bg.jpg) — a layered warm gradient stands in until then.
 */
export function LandingHero({
  defaultPlanId,
  landingBg,
}: {
  defaultPlanId?: string;
  landingBg?: string;
}) {
  const { firebaseUser } = useAuth();
  const [posters, setPosters] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db(), "content"), where("status", "==", "published"), limit(16)),
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

  const strip = posters.length > 0 ? [...posters, ...posters] : [];

  // Standard CTA — also the fallback the quick-checkout shows when no valid
  // default plan is configured.
  const subscribeNow = (
    <Link
      href="/plans"
      className="btn-gold inline-flex items-center gap-2 px-12 py-4 font-semibold rounded-xl text-lg"
    >
      Subscribe Now
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
      </svg>
    </Link>
  );

  return (
    <div className="relative w-full overflow-hidden min-h-[calc(100svh_-_4rem)]">
      {/* Cinematic background: optional image with a slow zoom, over layered
       * warm gradients that always look intentional even with no image. */}
      {/* Background. An admin-uploaded image is served optimized (resized to the
          viewport, WebP, cached) via next/image; the static file stands in until
          one is uploaded. */}
      {landingBg ? (
        <Image
          src={landingBg}
          alt=""
          aria-hidden
          fill
          priority
          sizes="100vw"
          className="object-cover animate-kenburns"
        />
      ) : (
        <div
          className="absolute inset-0 bg-cover bg-center animate-kenburns"
          style={{ backgroundImage: "url('/landing-bg.jpg')" }}
        />
      )}
      <div className="absolute inset-0 bg-[#0a0807]/45" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0807]/40 to-[var(--background)]" />
      {/* Gold glow pooling behind the headline */}
      <div className="absolute left-1/2 top-[34%] -translate-x-1/2 -translate-y-1/2 h-[420px] w-[820px] max-w-[90vw] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(230,174,74,0.18),transparent_70%)] blur-2xl" />

      <div className="relative z-10 flex flex-col min-h-[calc(100svh_-_4rem)]">
        <div className="flex-1 flex flex-col items-center justify-start pt-44 sm:pt-56 text-center px-6">
          <div className="flex flex-col items-center gap-4 animate-fade-in">
            <HomeQuickCheckout defaultPlanId={defaultPlanId ?? ""} fallback={subscribeNow} />
            {!firebaseUser && (
              <Link
                href="/auth/login"
                className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                Already have an account?{" "}
                <span className="text-[var(--foreground)] font-medium underline underline-offset-4 decoration-[var(--gold-3)]">
                  Sign in
                </span>
              </Link>
            )}
          </div>

        </div>

        {/* Bottom: right→left looping poster marquee with gold-tinted edge mask */}
        {strip.length > 0 && (
          <div className="w-full overflow-hidden pb-10 pt-6 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
            <div className="flex w-max gap-4 animate-marquee px-2">
              {strip.map((src, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className="relative h-44 sm:h-52 aspect-[2/3] rounded-xl overflow-hidden border border-white/5 shadow-xl shadow-black/60 flex-shrink-0 transition-transform hover:scale-[1.04]"
                >
                  {/* Decorative poster — served small (~160px) + lazy via next/image
                      instead of the full-size thumbnail, so the landing stays light. */}
                  <Image src={src} alt="" aria-hidden fill sizes="160px" className="object-cover" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
