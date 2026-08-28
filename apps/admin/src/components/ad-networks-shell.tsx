"use client";
import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminLayout } from "@/components/admin-layout";
import { useAuth } from "@/lib/auth-context";
import { confirmLeave, dirtySlugs, subscribeDirty } from "@/lib/dirty-networks";
import { Loader } from "@bistar/ui";

// Shared chrome for /ad-networks.
//
// ADMIN ONLY — three independent layers, because this panel controls what our
// ad spend optimises against:
//   1. the sidebar entry lives in the admin-only navItems list,
//   2. AdminLayout redirects a marketing-only account off any non-/marketing
//      route,
//   3. the explicit isAdmin gate below, and admin-only Firestore rules on
//      adNetworks / adNetworkSecrets / adAttributions / adPostbacks.
// Layer 3 is what makes a hand-typed URL useless to the marketing role.
const TABS = [
  { label: "Networks", href: "/ad-networks" },
  { label: "Events", href: "/ad-networks/events" },
  { label: "Deliveries", href: "/ad-networks/deliveries" },
  { label: "How it works", href: "/ad-networks/reference" },
];

export function AdNetworksShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAdmin, loading } = useAuth();

  // Closing the tab or reloading is the browser's own prompt; leaving via our
  // tab bar is handled on the link click below.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtySlugs().length === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    const unsub = subscribeDirty(() => {});
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      unsub();
    };
  }, []);

  const isActive = (href: string) =>
    href === "/ad-networks" ? pathname === "/ad-networks" : pathname.startsWith(href);

  return (
    <AdminLayout>
      {loading ? (
        <div className="py-20 flex justify-center">
          <Loader />
        </div>
      ) : !isAdmin ? (
        <div className="py-20 text-center">
          <h1 className="text-xl font-bold">Admins only</h1>
          <p className="text-sm text-[var(--muted)] mt-2">
            Ad-network postbacks decide what our campaigns optimise against, so this panel is
            restricted to administrators.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6">
            <h1 className="text-2xl font-bold">Ad Networks</h1>
            <p className="text-sm text-[var(--muted)] mt-1">
              S2S postbacks and event triggers for PropellerAds, RichAds, EvaDav, AdMaven, PopAds,
              PopCash and HilltopAds.
            </p>
            <nav className="mt-4 flex gap-1 border-b border-[var(--border)] overflow-x-auto">
              {TABS.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  onClick={(e) => {
                    if (!confirmLeave()) e.preventDefault();
                  }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                    isActive(t.href)
                      ? "border-[var(--primary)] text-[var(--foreground)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
          </div>
          {children}
        </>
      )}
    </AdminLayout>
  );
}
