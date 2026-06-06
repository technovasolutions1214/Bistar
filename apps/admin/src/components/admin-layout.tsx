"use client";
import React, { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Sidebar } from "@/components/sidebar";
import { Loader } from "@novaflix/ui";

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { firebaseUser, userData, loading, isAdmin, isMarketing } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isMarketingRoute =
    pathname === "/marketing" || pathname.startsWith("/marketing/");

  // A marketing-only user (NOT admin) may access ONLY /marketing/*. Everything
  // else in the dashboard is admin-only.
  const marketingBlocked =
    !loading && !!userData && isMarketing && !isAdmin && !isMarketingRoute;

  useEffect(() => {
    if (!loading && !firebaseUser) {
      router.replace("/login");
    }
  }, [loading, firebaseUser, router]);

  useEffect(() => {
    if (marketingBlocked) {
      router.replace("/marketing");
    }
  }, [marketingBlocked, router]);

  if (loading || !firebaseUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <Loader />
      </div>
    );
  }

  if (!userData || (!isAdmin && !isMarketing)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 rounded-full bg-[var(--danger)]/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-[var(--danger)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold">Unauthorized</h1>
        <p className="text-[var(--muted)]">You do not have access to this dashboard.</p>
      </div>
    );
  }

  // Marketing-only user landed on a non-marketing route — show the loader while
  // the effect above redirects them to /marketing. They never see this content.
  if (marketingBlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <Loader />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="lg:ml-64 min-h-screen">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
