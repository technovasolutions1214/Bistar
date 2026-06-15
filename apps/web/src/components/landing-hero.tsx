"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
export function LandingHero({ defaultPlanId }: { defaultPlanId?: string }) {
  const { firebaseUser } = useAuth();
  const [posters, setPosters] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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
      <div
        className="absolute inset-0 bg-cover bg-center animate-kenburns"
        style={{ backgroundImage: "url('/landing-bg.jpg')" }}
      />
      <div className="absolute inset-0 bg-[#0a0807]/80" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0807]/40 to-[var(--background)]" />
      {/* Gold glow pooling behind the headline */}
      <div className="absolute left-1/2 top-[34%] -translate-x-1/2 -translate-y-1/2 h-[420px] w-[820px] max-w-[90vw] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(230,174,74,0.18),transparent_70%)] blur-2xl" />

      <div className="relative z-10 flex flex-col min-h-[calc(100svh_-_4rem)]">
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          {/* Eyebrow */}
          <span className="eyebrow mb-5 animate-fade-in">Premium streaming · Movies & web series</span>

          {/* Wordmark */}
          <h2 className="text-5xl sm:text-7xl font-extrabold tracking-tight mb-5 animate-fade-in">
            <span className="text-gold">Bistar</span>
          </h2>

          {/* Headline */}
          <h1 className="text-2xl sm:text-4xl font-bold mb-4 max-w-3xl leading-tight text-shadow animate-fade-in">
            Unlimited movies & series.
            <br className="hidden sm:block" /> Streaming starts the moment you subscribe.
          </h1>

          <p className="text-[var(--muted)] text-base sm:text-lg mb-9 max-w-xl leading-relaxed animate-fade-in">
            One subscription unlocks the entire Bistar library in crisp HD — watch
            on any device, cancel anytime.
          </p>

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

          {/* Trust row */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs sm:text-sm text-[var(--muted)] animate-fade-in">
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-[var(--gold-2)]" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              Full HD streaming
            </span>
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-[var(--gold-2)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              Watch on any device
            </span>
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-[var(--gold-2)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M8 6h10v10" /></svg>
              Cancel anytime
            </span>
          </div>
        </div>

        {/* Bottom: right→left looping poster marquee with gold-tinted edge mask */}
        {strip.length > 0 && (
          <div className="w-full overflow-hidden pb-10 pt-6 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
            <div className="flex w-max gap-4 animate-marquee px-2">
              {strip.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  className="h-44 sm:h-52 aspect-[2/3] object-cover rounded-xl border border-white/5 shadow-xl shadow-black/60 flex-shrink-0 transition-transform hover:scale-[1.04]"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
