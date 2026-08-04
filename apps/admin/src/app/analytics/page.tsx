"use client";
import React, { useEffect, useMemo, useState } from "react";
import { collection, getCountFromServer, onSnapshot, orderBy, query, Timestamp, where } from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import {
  DailyBarChart,
  DayCell,
  EmptyState,
  ErrorBanner,
  LiveStatus,
  Panel,
  RangeTabs,
  SkeletonCards,
  SkeletonPanel,
  StatCard,
} from "@/components/analytics-ui";
import {
  addDays,
  DAY_MS,
  daysDescending,
  formatCount,
  formatMoney,
  istMidnightMs,
  istToday,
  percentChange,
} from "@/lib/ist";
import type { AnalyticsEntry } from "@bistar/shared";

// ---------------------------------------------------------------------------
// Platform analytics.
//
// Past IST days come from the nightly `analytics/{date}` rollups; the days the
// aggregator hasn't reached yet (today, and yesterday if it hasn't run) are
// computed live from Firestore. Everything is an onSnapshot subscription, so
// signups, subscriptions and revenue appear as they happen.
//
// Every day in the selected range is rendered, so today is always visible and a
// quiet day reads as an explicit zero rather than a missing row.
//
// Revenue here is bucketed on the day the transaction was CREATED. The Marketing
// panel buckets conversions on the day the payment was CONFIRMED, so the two can
// differ by a day for payments that straddle IST midnight.
// ---------------------------------------------------------------------------

const RANGES = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "custom", label: "Custom" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

interface LiveDay {
  newUsers: number;
  newSubscriptions: number;
  revenue: number;
  revenueCurrency: string;
}

/**
 * Live values for a single IST day, straight off Firestore. Used for days the
 * nightly aggregator hasn't written yet — without this, "today" simply had no
 * row and the panel looked a day behind.
 */
function useLiveDay(date: string | null, onError: (scope: string, e: unknown) => void): LiveDay | null {
  const [value, setValue] = useState<LiveDay | null>(null);

  useEffect(() => {
    if (!date) {
      setValue(null);
      return;
    }
    const startMs = istMidnightMs(date);
    const start = Timestamp.fromMillis(startMs);
    const end = Timestamp.fromMillis(startMs + DAY_MS);

    const acc: LiveDay = { newUsers: 0, newSubscriptions: 0, revenue: 0, revenueCurrency: "INR" };
    const publish = () => setValue({ ...acc });

    const unsubs = [
      onSnapshot(
        query(collection(db(), "users"), where("createdAt", ">=", start), where("createdAt", "<", end)),
        (snap) => {
          acc.newUsers = snap.size;
          publish();
        },
        (e) => onError("new users", e),
      ),
      onSnapshot(
        query(
          collection(db(), "users"),
          where("subscription.startDate", ">=", start),
          where("subscription.startDate", "<", end),
        ),
        (snap) => {
          acc.newSubscriptions = snap.size;
          publish();
        },
        (e) => onError("new subscriptions", e),
      ),
      // Range on the single `createdAt` field (auto-indexed) and filter status in
      // code, so this needs no composite index — the same shape the nightly
      // aggregator uses.
      onSnapshot(
        query(collection(db(), "transactions"), where("createdAt", ">=", start), where("createdAt", "<", end)),
        (snap) => {
          let sum = 0;
          snap.forEach((d) => {
            const x = d.data() as { status?: string; amount?: number; currency?: string };
            if (x.status !== "success") return;
            sum += Number(x.amount ?? 0);
            if (x.currency) acc.revenueCurrency = x.currency;
          });
          acc.revenue = sum;
          publish();
        },
        (e) => onError("revenue", e),
      ),
    ];
    return () => unsubs.forEach((f) => f());
  }, [date, onError]);

  return value;
}

/** Platform-wide totals as of right now (not a nightly snapshot). */
function useLiveTotals(refreshKey: number, onError: (scope: string, e: unknown) => void) {
  const [totals, setTotals] = useState<{ users: number; activeSubs: number; published: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [u, s, p] = await Promise.all([
          getCountFromServer(collection(db(), "users")),
          getCountFromServer(query(collection(db(), "users"), where("subscription.status", "==", "active"))),
          getCountFromServer(query(collection(db(), "content"), where("status", "==", "published"))),
        ]);
        if (cancelled) return;
        setTotals({ users: u.data().count, activeSubs: s.data().count, published: p.data().count });
      } catch (e) {
        if (!cancelled) onError("platform totals", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, onError]);

  return totals;
}

export default function AnalyticsPage() {
  const today = istToday();

  const [range, setRange] = useState<RangeKey>("30");
  const [customStart, setCustomStart] = useState(addDays(today, -29));
  const [customEnd, setCustomEnd] = useState(today);

  const [entries, setEntries] = useState<Record<string, AnalyticsEntry>>({});
  const [loaded, setLoaded] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalsKey, setTotalsKey] = useState(0);

  const onError = useMemo(
    () => (scope: string, e: unknown) => {
      console.error(`Analytics (${scope}):`, e);
      setError(e instanceof Error ? e.message : String(e));
    },
    [],
  );

  // Window + the equal-length window before it, for period-over-period deltas.
  const { start, end, span, subscribeFrom } = useMemo(() => {
    if (range === "custom") {
      const s = customStart <= customEnd ? customStart : customEnd;
      const e = customStart <= customEnd ? customEnd : customStart;
      const n = Math.max(1, Math.round((istMidnightMs(e) - istMidnightMs(s)) / DAY_MS) + 1);
      return { start: s, end: e, span: n, subscribeFrom: addDays(s, -n) };
    }
    const n = Number(range);
    const s = addDays(today, -(n - 1));
    return { start: s, end: today, span: n, subscribeFrom: addDays(s, -n) };
  }, [range, customStart, customEnd, today]);

  /* --- rollups (live) --- */
  useEffect(() => {
    setLoaded(false);
    const unsub = onSnapshot(
      query(
        collection(db(), "analytics"),
        where("date", ">=", subscribeFrom),
        where("date", "<=", end),
        orderBy("date", "asc"),
      ),
      (snap) => {
        const next: Record<string, AnalyticsEntry> = {};
        snap.forEach((d) => {
          next[d.id] = d.data() as AnalyticsEntry;
        });
        setEntries(next);
        setLoaded(true);
        setUpdatedAt(Date.now());
      },
      (e) => {
        onError("daily rollups", e);
        setLoaded(true);
      },
    );
    return unsub;
  }, [subscribeFrom, end, onError]);

  // Today is always live. Yesterday goes live too until its rollup lands.
  const yesterday = addDays(today, -1);
  const todayLive = useLiveDay(today >= start && today <= end ? today : null, onError);
  const yesterdayLive = useLiveDay(
    yesterday >= start && yesterday <= end && !entries[yesterday] ? yesterday : null,
    onError,
  );
  const totals = useLiveTotals(totalsKey, onError);

  // Refresh the platform-wide counts whenever today's signups change, and hourly.
  useEffect(() => {
    setTotalsKey((k) => k + 1);
  }, [todayLive?.newUsers, todayLive?.newSubscriptions]);
  useEffect(() => {
    const id = setInterval(() => setTotalsKey((k) => k + 1), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (todayLive) setUpdatedAt(Date.now());
  }, [todayLive]);

  /* --- merge rollups + live into one day-indexed series --- */

  type Row = {
    date: string;
    live: boolean;
    aggregated: boolean;
    newUsers: number;
    newSubscriptions: number;
    revenue: number;
    totalUsers: number | null;
    activeSubscriptions: number | null;
    totalPublishedContent: number | null;
  };

  const rowFor = useMemo(
    () =>
      (date: string): Row => {
        const live = date === today ? todayLive : date === yesterday ? yesterdayLive : null;
        const e = entries[date];
        if (live) {
          return {
            date,
            live: true,
            aggregated: false,
            newUsers: live.newUsers,
            newSubscriptions: live.newSubscriptions,
            revenue: live.revenue,
            // Snapshot columns are taken at IST midnight; they don't exist yet.
            totalUsers: null,
            activeSubscriptions: null,
            totalPublishedContent: null,
          };
        }
        return {
          date,
          live: false,
          aggregated: !!e,
          newUsers: e?.newUsers ?? 0,
          newSubscriptions: e?.newSubscriptions ?? 0,
          revenue: e?.revenue ?? 0,
          totalUsers: e ? e.totalUsers : null,
          activeSubscriptions: e ? e.activeSubscriptions : null,
          totalPublishedContent: e ? e.totalPublishedContent : null,
        };
      },
    [entries, today, yesterday, todayLive, yesterdayLive],
  );

  const rows = useMemo(() => daysDescending(start, end).map(rowFor), [start, end, rowFor]);
  const prevRows = useMemo(
    () => daysDescending(addDays(start, -span), addDays(start, -1)).map(rowFor),
    [start, span, rowFor],
  );

  const sum = (rs: Row[], k: "newUsers" | "newSubscriptions" | "revenue") =>
    rs.reduce((a, r) => a + r[k], 0);

  const cur = {
    newUsers: sum(rows, "newUsers"),
    newSubs: sum(rows, "newSubscriptions"),
    revenue: sum(rows, "revenue"),
  };
  const prev = {
    newUsers: sum(prevRows, "newUsers"),
    newSubs: sum(prevRows, "newSubscriptions"),
    revenue: sum(prevRows, "revenue"),
  };

  const currency = useMemo(
    () => Object.values(entries).find((e) => e.revenueCurrency)?.revenueCurrency ?? "INR",
    [entries],
  );

  const chronological = useMemo(() => [...rows].reverse(), [rows]);
  const revenueSeries = useMemo(
    () => chronological.map((r) => ({ date: r.date, value: r.revenue })),
    [chronological],
  );
  const signupSeries = useMemo(
    () => chronological.map((r) => ({ date: r.date, value: r.newUsers })),
    [chronological],
  );

  const missingDays = rows.filter((r) => !r.aggregated && !r.live).length;
  const comparison = `vs previous ${span} day${span === 1 ? "" : "s"}`;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Analytics</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <p className="text-sm text-[var(--muted)]">
                {start} → {end} · day boundaries are IST (Asia/Kolkata)
              </p>
              <LiveStatus updatedAt={updatedAt} live={loaded} error={error} />
            </div>
          </div>
          <RangeTabs options={RANGES} value={range} onChange={setRange} />
        </div>

        {range === "custom" && (
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div>
              <label htmlFor="start-date" className="mb-1 block text-xs text-[var(--muted)]">
                Start date (IST)
              </label>
              <input
                id="start-date"
                type="date"
                value={customStart}
                max={today}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
            <div>
              <label htmlFor="end-date" className="mb-1 block text-xs text-[var(--muted)]">
                End date (IST)
              </label>
              <input
                id="end-date"
                type="date"
                value={customEnd}
                max={today}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
            <p className="pb-2 text-xs text-[var(--muted)]">{span} days selected</p>
          </div>
        )}

        {error && <ErrorBanner message={`Couldn't load analytics: ${error}`} />}

        {/* Right now — live platform totals */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Total users"
            value={totals ? formatCount(totals.users) : "—"}
            hint="right now"
            loading={!totals}
          />
          <StatCard
            label="Active subscriptions"
            value={totals ? formatCount(totals.activeSubs) : "—"}
            hint="right now"
            tone="success"
            loading={!totals}
          />
          <StatCard
            label="Published content"
            value={totals ? formatCount(totals.published) : "—"}
            hint="right now"
            loading={!totals}
          />
          <StatCard
            label="Today so far"
            value={todayLive ? formatMoney(todayLive.revenue, todayLive.revenueCurrency) : "—"}
            hint={
              todayLive
                ? `${formatCount(todayLive.newUsers)} signups · ${formatCount(todayLive.newSubscriptions)} subs`
                : "loading"
            }
            tone={todayLive && todayLive.revenue > 0 ? "success" : "default"}
            loading={!todayLive && today >= start && today <= end}
          />
        </div>

        {!loaded ? (
          <div className="space-y-6">
            <SkeletonCards count={3} />
            <SkeletonPanel rows={6} />
          </div>
        ) : (
          <>
            {/* Range totals with period-over-period deltas */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="New users"
                value={formatCount(cur.newUsers)}
                delta={percentChange(cur.newUsers, prev.newUsers)}
                hint={comparison}
              />
              <StatCard
                label="New subscriptions"
                value={formatCount(cur.newSubs)}
                delta={percentChange(cur.newSubs, prev.newSubs)}
                hint={comparison}
                tone="warning"
              />
              <StatCard
                label="Revenue"
                value={formatMoney(cur.revenue, currency)}
                delta={percentChange(cur.revenue, prev.revenue)}
                hint={comparison}
                tone="success"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Panel title="Revenue per day" subtitle="By transaction creation date (IST)" bodyClassName="pt-1">
                <DailyBarChart
                  data={revenueSeries}
                  format={(n) => formatMoney(n, currency)}
                  todayDate={today}
                  label="Revenue per IST day"
                />
              </Panel>
              <Panel title="New users per day" subtitle="Signups by IST calendar day" bodyClassName="pt-1">
                <DailyBarChart
                  data={signupSeries}
                  format={(n) => `${formatCount(n)} signup${n === 1 ? "" : "s"}`}
                  todayDate={today}
                  label="New users per IST day"
                />
              </Panel>
            </div>

            <Panel
              title="Daily breakdown (IST)"
              actions={
                <span className="text-xs text-[var(--muted)]">
                  {rows.length} day{rows.length === 1 ? "" : "s"}
                </span>
              }
            >
              {rows.length === 0 ? (
                <EmptyState title="No days in this range." />
              ) : (
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <caption className="sr-only">Per-day users, subscriptions and revenue</caption>
                    <thead className="sticky top-0 z-10 bg-[var(--card)]">
                      <tr className="text-left text-xs text-[var(--muted)]">
                        <th scope="col" className="border-b border-[var(--border)] px-5 py-2.5 font-medium">Date</th>
                        <th scope="col" className="border-b border-[var(--border)] px-3 py-2.5 text-right font-medium">New users</th>
                        <th scope="col" className="border-b border-[var(--border)] px-3 py-2.5 text-right font-medium">New subs</th>
                        <th scope="col" className="border-b border-[var(--border)] px-3 py-2.5 text-right font-medium">Revenue</th>
                        <th scope="col" className="border-b border-[var(--border)] px-3 py-2.5 text-right font-medium">Total users</th>
                        <th scope="col" className="border-b border-[var(--border)] px-3 py-2.5 text-right font-medium">Active subs</th>
                        <th scope="col" className="border-b border-[var(--border)] px-5 py-2.5 text-right font-medium">Published</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const dim = !r.aggregated && !r.live;
                        const muted = (v: number) => (v ? "" : "text-[var(--muted)]/50");
                        return (
                          <tr
                            key={r.date}
                            className={`border-b border-[var(--border)] last:border-0 transition-colors hover:bg-[var(--card-hover)] ${
                              r.date === today ? "bg-[var(--primary)]/[0.06]" : ""
                            }`}
                            title={dim ? "No rollup was written for this day." : undefined}
                          >
                            <td className="px-5 py-2.5">
                              <DayCell date={r.date} todayDate={today} />
                            </td>
                            {dim ? (
                              <td colSpan={6} className="px-3 py-2.5 text-right text-xs text-[var(--muted)]/60">
                                not aggregated
                              </td>
                            ) : (
                              <>
                                <td className={`px-3 py-2.5 text-right tabular-nums ${muted(r.newUsers)}`}>
                                  {formatCount(r.newUsers)}
                                </td>
                                <td className={`px-3 py-2.5 text-right tabular-nums ${muted(r.newSubscriptions)}`}>
                                  {formatCount(r.newSubscriptions)}
                                </td>
                                <td
                                  className={`px-3 py-2.5 text-right tabular-nums ${
                                    r.revenue ? "font-medium text-[var(--success)]" : "text-[var(--muted)]/50"
                                  }`}
                                >
                                  {formatMoney(r.revenue, currency)}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-[var(--muted)]">
                                  {r.totalUsers == null ? "—" : formatCount(r.totalUsers)}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-[var(--muted)]">
                                  {r.activeSubscriptions == null ? "—" : formatCount(r.activeSubscriptions)}
                                </td>
                                <td className="px-5 py-2.5 text-right tabular-nums text-[var(--muted)]">
                                  {r.totalPublishedContent == null ? "—" : formatCount(r.totalPublishedContent)}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="border-t border-[var(--border)] px-5 py-3 text-xs leading-relaxed text-[var(--muted)]">
                Each row covers IST 00:00 → the next IST 00:00. Today (and yesterday until the
                aggregator runs) is queried live, so its snapshot columns — total users, active subs,
                published — show &ldquo;—&rdquo; until midnight.
                {missingDays > 0 && ` ${missingDays} day${missingDays === 1 ? " has" : "s have"} no rollup and is shown as "not aggregated".`}
              </p>
            </Panel>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
