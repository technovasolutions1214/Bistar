"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminLayout } from "@/components/admin-layout";
import { useAuth } from "@/lib/auth-context";

// Shared chrome for the /marketing area: the admin layout (with the role-walled
// sidebar) plus a tab bar. The "Team" tab is admin-only — marketing staff never
// see it, and the API behind it enforces admin separately.
export function MarketingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAdmin } = useAuth();

  const tabs = [
    { label: "Overview", href: "/marketing" },
    { label: "Pixels", href: "/marketing/pixels" },
    ...(isAdmin ? [{ label: "Team", href: "/marketing/team" }] : []),
  ];

  const isActive = (href: string) =>
    href === "/marketing" ? pathname === "/marketing" : pathname.startsWith(href);

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Marketing</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Pixels, attribution, and conversion analytics.
        </p>
        <nav className="mt-4 flex gap-1 border-b border-[var(--border)]">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
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
    </AdminLayout>
  );
}
