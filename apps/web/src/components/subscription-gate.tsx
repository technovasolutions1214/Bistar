"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

interface SubscriptionGateProps {
  requireGate: boolean;
  children: React.ReactNode;
}

export function SubscriptionGate({ requireGate, children }: SubscriptionGateProps) {
  const { hasActiveSubscription, loading } = useAuth();

  // Don't flash the gate while loading
  if (loading || !requireGate || hasActiveSubscription) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      {/* Blurred content behind the overlay */}
      <div className="pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>

      {/* Paywall overlay */}
      <div className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-lg bg-black/60 bg-gradient-to-t from-black via-black/80 to-transparent">
        <div className="text-center px-6 max-w-lg">
          {/* Logo */}
          <div className="mb-6">
            <span className="text-3xl font-bold tracking-tight">
              Nova<span className="text-[var(--primary)]">Flix</span>
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold mb-3">
            Subscribe to access all content
          </h2>
          <p className="text-[var(--muted)] mb-8 text-sm sm:text-base">
            Get unlimited access to movies, series, and exclusive content with a NovaFlix subscription.
          </p>

          <Link
            href="/plans"
            className="inline-block px-8 py-3 bg-[var(--primary)] text-white font-semibold rounded-lg hover:bg-[var(--primary-hover)] transition-colors text-lg"
          >
            View Plans
          </Link>
        </div>
      </div>
    </div>
  );
}
