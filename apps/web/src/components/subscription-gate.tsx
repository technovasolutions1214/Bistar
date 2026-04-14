"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

interface SubscriptionGateProps {
  requireGate: boolean;
  children: React.ReactNode;
}

export function SubscriptionGate({ requireGate, children }: SubscriptionGateProps) {
  const { hasActiveSubscription, loading, firebaseUser } = useAuth();

  // Show loading skeleton while auth state is resolving and gate is required
  if (loading && requireGate) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-6">
        <div className="animate-pulse space-y-4 w-full max-w-md">
          <div className="h-20 w-20 rounded-full bg-[var(--card)] mx-auto" />
          <div className="h-8 w-3/4 bg-[var(--card)] rounded mx-auto" />
          <div className="h-4 w-full bg-[var(--card)] rounded" />
          <div className="h-4 w-2/3 bg-[var(--card)] rounded" />
          <div className="h-12 w-40 bg-[var(--card)] rounded-lg mx-auto" />
        </div>
      </div>
    );
  }

  // Don't gate if not required or user has subscription
  if (!requireGate || hasActiveSubscription) {
    return <>{children}</>;
  }

  // When gate is active: completely hide content, show full paywall
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        {/* Icon */}
        <div className="mx-auto mb-6 w-20 h-20 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
          <svg className="w-10 h-10 text-[var(--primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>

        {/* Logo */}
        <div className="mb-4">
          <span className="text-3xl font-bold tracking-tight">
            Nova<span className="text-[var(--primary)]">Flix</span>
          </span>
        </div>

        <h2 className="text-2xl sm:text-3xl font-bold mb-3">
          Subscribe to unlock content
        </h2>
        <p className="text-[var(--muted)] mb-8 text-sm sm:text-base leading-relaxed">
          Get unlimited access to all movies, web series, and exclusive content
          with a NovaFlix subscription plan.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/plans"
            className="inline-flex items-center justify-center px-8 py-3 bg-[var(--primary)] text-white font-semibold rounded-lg hover:bg-[var(--primary-hover)] transition-colors text-base"
          >
            View Plans
          </Link>
          {!firebaseUser && (
            <Link
              href="/auth/login"
              className="inline-flex items-center justify-center px-8 py-3 bg-[var(--card)] text-white font-semibold rounded-lg border border-[var(--border)] hover:bg-[var(--card-hover)] transition-colors text-base"
            >
              Sign In
            </Link>
          )}
        </div>

        {/* Feature highlights */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)]">
            <div className="text-[var(--primary)] mb-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold mb-1">Unlimited Streaming</h3>
            <p className="text-xs text-[var(--muted)]">Watch anytime, anywhere</p>
          </div>
          <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)]">
            <div className="text-[var(--primary)] mb-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold mb-1">HD Quality</h3>
            <p className="text-xs text-[var(--muted)]">Crystal clear video</p>
          </div>
          <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--border)]">
            <div className="text-[var(--primary)] mb-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold mb-1">Huge Library</h3>
            <p className="text-xs text-[var(--muted)]">Movies & web series</p>
          </div>
        </div>
      </div>
    </div>
  );
}
