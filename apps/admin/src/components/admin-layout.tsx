"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Sidebar } from "@/components/sidebar";
import { Loader } from "@novaflix/ui";

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { firebaseUser, userData, loading, isAdmin } = useAuth();
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!loading && !firebaseUser) {
      setRedirecting(true);
      router.replace("/login");
    }
  }, [loading, firebaseUser, router]);

  if (loading || redirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <Loader />
      </div>
    );
  }

  if (!userData || !isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 rounded-full bg-[var(--danger)]/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-[var(--danger)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold">Unauthorized</h1>
        <p className="text-[var(--muted)]">You do not have admin access to this dashboard.</p>
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
