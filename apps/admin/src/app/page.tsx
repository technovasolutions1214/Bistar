"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { ErrorBanner, LiveStatus, Panel, StatCard } from "@/components/analytics-ui";
import { formatCount, formatMoney, istToday, istTodayMidnightMs } from "@/lib/ist";
import type { User } from "@bistar/shared";

// Live overview of the platform. Every figure here is either a Firestore
// onSnapshot subscription or a server-side count refreshed whenever one of those
// subscriptions fires, so the dashboard tracks the database in real time.
//
// The counts used to come from `getDocs(..., limit(100))` and report the page
// size as the total, which capped "Total Users" at 100 no matter how many
// existed. They are aggregation queries now — exact, and one read each.

interface Totals {
  users: number;
  activeSubs: number;
  content: number;
  published: number;
}

interface TodayPayments {
  success: number;
  failed: number;
  pending: number;
  revenue: number;
  currency: string;
}

export default function DashboardPage() {
  const [recentUsers, setRecentUsers] = useState<User[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [pastRevenue, setPastRevenue] = useState<number | null>(null);
  const [todayPayments, setTodayPayments] = useState<TodayPayments | null>(null);
  const [todaySignups, setTodaySignups] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalsKey, setTotalsKey] = useState(0);

  const today = istToday();

  const onError = useMemo(
    () => (scope: string, e: unknown) => {
      console.error(`Dashboard (${scope}):`, e);
      setError(e instanceof Error ? e.message : String(e));
    },
    [],
  );

  /* --- recent signups (live) --- */
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db(), "users"), orderBy("createdAt", "desc"), limit(8)),
      (snap) => {
        setRecentUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() } as User)));
        setUpdatedAt(Date.now());
        // A new signup moves the platform-wide counts too.
        setTotalsKey((k) => k + 1);
      },
      (e) => onError("recent signups", e),
    );
    return unsub;
  }, [onError]);

  /* --- today's signups (live) --- */
  useEffect(() => {
    const start = Timestamp.fromMillis(istTodayMidnightMs());
    const unsub = onSnapshot(
      query(collection(db(), "users"), where("createdAt", ">=", start)),
      (snap) => {
        setTodaySignups(snap.size);
        setUpdatedAt(Date.now());
      },
      (e) => onError("today's signups", e),
    );
    return unsub;
  }, [onError]);

  /* --- today's payments (live) --- */
  useEffect(() => {
    const start = Timestamp.fromMillis(istTodayMidnightMs());
    const unsub = onSnapshot(
      query(collection(db(), "transactions"), where("createdAt", ">=", start)),
      (snap) => {
        const t: TodayPayments = { success: 0, failed: 0, pending: 0, revenue: 0, currency: "INR" };
        snap.forEach((d) => {
          const x = d.data() as { status?: string; amount?: number; currency?: string };
          if (x.status === "success") {
            t.success++;
            t.revenue += Number(x.amount ?? 0);
            if (x.currency) t.currency = x.currency;
          } else if (x.status === "failed" || x.status === "failure") {
            t.failed++;
          } else {
            t.pending++;
          }
        });
        setTodayPayments(t);
        setUpdatedAt(Date.now());
      },
      (e) => onError("today's payments", e),
    );
    return unsub;
  }, [onError]);

  /* --- all-time revenue base from the daily rollups (live) --- */
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db(), "analytics"),
      (snap) => {
        let sum = 0;
        snap.forEach((d) => {
          // Today has no rollup yet — it's added live below, so skip it here to
          // avoid double counting once the aggregator catches up.
          if (d.id === today) return;
          sum += Number((d.data() as { revenue?: number }).revenue ?? 0);
        });
        setPastRevenue(sum);
        setUpdatedAt(Date.now());
      },
      (e) => onError("revenue rollups", e),
    );
    return unsub;
  }, [today, onError]);

  /* --- exact platform counts, refreshed whenever something moves --- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [u, s, c, p] = await Promise.all([
          getCountFromServer(collection(db(), "users")),
          getCountFromServer(query(collection(db(), "users"), where("subscription.status", "==", "active"))),
          getCountFromServer(collection(db(), "content")),
          getCountFromServer(query(collection(db(), "content"), where("status", "==", "published"))),
        ]);
        if (cancelled) return;
        setTotals({
          users: u.data().count,
          activeSubs: s.data().count,
          content: c.data().count,
          published: p.data().count,
        });
        setUpdatedAt(Date.now());
      } catch (e) {
        if (!cancelled) onError("platform totals", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [totalsKey, onError]);

  const allTimeRevenue =
    pastRevenue == null || todayPayments == null ? null : pastRevenue + todayPayments.revenue;
  const currency = todayPayments?.currency ?? "INR";

  const attemptsToday = todayPayments
    ? todayPayments.success + todayPayments.failed + todayPayments.pending
    : 0;
  const successRate =
    todayPayments && attemptsToday ? (todayPayments.success / attemptsToday) * 100 : null;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Live overview of your Bistar platform · {today} IST
            </p>
          </div>
          <LiveStatus updatedAt={updatedAt} live={!error} error={error} />
        </div>

        {error && <ErrorBanner message={`Some figures couldn't load: ${error}`} />}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Total users"
            value={totals ? formatCount(totals.users) : "—"}
            hint={todaySignups != null ? `+${formatCount(todaySignups)} today` : undefined}
            loading={!totals}
          />
          <StatCard
            label="Active subscriptions"
            value={totals ? formatCount(totals.activeSubs) : "—"}
            hint={
              totals && totals.users
                ? `${((totals.activeSubs / totals.users) * 100).toFixed(1)}% of users`
                : undefined
            }
            tone="success"
            loading={!totals}
          />
          <StatCard
            label="Published content"
            value={totals ? formatCount(totals.published) : "—"}
            hint={totals ? `${formatCount(totals.content)} total titles` : undefined}
            tone="warning"
            loading={!totals}
          />
          <StatCard
            label="Revenue (all time)"
            value={allTimeRevenue == null ? "—" : formatMoney(allTimeRevenue, currency)}
            hint={
              todayPayments ? `${formatMoney(todayPayments.revenue, currency)} today` : undefined
            }
            tone="success"
            loading={allTimeRevenue == null}
          />
        </div>

        {/* Today's payment funnel — where checkouts actually end up. */}
        <Panel
          title="Payments today"
          subtitle="Every checkout started since IST midnight"
          actions={
            successRate != null ? (
              <span className="text-xs text-[var(--muted)]">
                {successRate.toFixed(0)}% success rate
              </span>
            ) : null
          }
        >
          {!todayPayments || attemptsToday === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">
              No checkouts started today yet.
            </div>
          ) : (
            <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
              <FunnelCell label="Successful" value={todayPayments.success} color="var(--success)" total={attemptsToday} />
              <FunnelCell label="Pending" value={todayPayments.pending} color="var(--warning)" total={attemptsToday} />
              <FunnelCell label="Failed" value={todayPayments.failed} color="var(--danger)" total={attemptsToday} />
            </div>
          )}
        </Panel>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Quick actions" bodyClassName="p-5">
            <div className="space-y-2.5">
              <QuickAction href="/content/new" label="Add new content" primary />
              <QuickAction href="/analytics" label="View analytics" />
              <QuickAction href="/marketing" label="Marketing & attribution" />
              <QuickAction href="/users" label="Manage users" />
            </div>
          </Panel>

          <Panel
            className="lg:col-span-2"
            title="Recent signups"
            actions={
              <Link
                href="/users"
                className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
              >
                View all
              </Link>
            }
          >
            {recentUsers.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">No users yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {recentUsers.map((user) => (
                  <li key={user.uid}>
                    <Link
                      href={`/users/${user.uid}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-[var(--card-hover)]"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {user.photoURL ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={user.photoURL}
                            alt=""
                            className="h-9 w-9 rounded-full ring-2 ring-[var(--border)]"
                          />
                        ) : (
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary)]/20 text-sm font-medium text-[var(--primary)] ring-2 ring-[var(--border)]">
                            {user.displayName?.charAt(0) || "U"}
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {user.displayName || "Unnamed"}
                          </span>
                          <span className="block truncate text-xs text-[var(--muted)]">
                            {user.email || user.phone || user.uid}
                          </span>
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                          user.subscription?.status === "active"
                            ? "bg-[var(--success)]/10 text-[var(--success)]"
                            : "bg-[var(--muted)]/10 text-[var(--muted)]"
                        }`}
                      >
                        {user.subscription?.status || "Free"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </AdminLayout>
  );
}

function FunnelCell({
  label,
  value,
  color,
  total,
}: {
  label: string;
  value: number;
  color: string;
  total: number;
}) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color }}>
        {formatCount(value)}
      </p>
      <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </span>
      <p className="mt-1 text-xs tabular-nums text-[var(--muted)]">{pct.toFixed(0)}% of attempts</p>
    </div>
  );
}

function QuickAction({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
        primary
          ? "bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--primary-hover)]"
          : "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--card-hover)]"
      }`}
    >
      {label}
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </Link>
  );
}
