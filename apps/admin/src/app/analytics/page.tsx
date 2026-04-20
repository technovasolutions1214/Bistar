"use client";
import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  getCountFromServer,
} from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Button, Loader } from "@novaflix/ui";
import type { AnalyticsEntry } from "@novaflix/shared";

type DateRange = "7d" | "30d" | "custom";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// IST calendar date for a given instant, formatted YYYY-MM-DD.
function istDateString(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// IST midnight (00:00 +05:30) on a given IST date, returned as a UTC instant.
function istMidnightUtc(istDateStr: string): Date {
  return new Date(`${istDateStr}T00:00:00+05:30`);
}

function formatRangeDate(d: Date): string {
  return istDateString(d);
}

function todayIst(): string {
  return istDateString(new Date());
}

function yesterdayIst(): string {
  return istDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

interface LiveDeltas {
  newUsers: number;
  newSubscriptions: number;
  revenue: number;
  revenueCurrency: string;
}

const ZERO_DELTAS: LiveDeltas = { newUsers: 0, newSubscriptions: 0, revenue: 0, revenueCurrency: "INR" };

// Live count for one IST day. Used for "Today", since the aggregator hasn't run yet.
async function fetchLiveDeltas(istDateStr: string): Promise<LiveDeltas> {
  const start = Timestamp.fromDate(istMidnightUtc(istDateStr));
  const end = Timestamp.fromDate(new Date(istMidnightUtc(istDateStr).getTime() + 24 * 60 * 60 * 1000));

  const newUsersSnap = await getCountFromServer(
    query(collection(db(), "users"), where("createdAt", ">=", start), where("createdAt", "<", end)),
  );
  const newSubsSnap = await getCountFromServer(
    query(
      collection(db(), "users"),
      where("subscription.startDate", ">=", start),
      where("subscription.startDate", "<", end),
    ),
  );
  const txnsSnap = await getDocs(
    query(
      collection(db(), "transactions"),
      where("status", "==", "success"),
      where("completedAt", ">=", start),
      where("completedAt", "<", end),
    ),
  );
  let revenue = 0;
  let revenueCurrency = "INR";
  txnsSnap.forEach((d) => {
    const data = d.data() as { amount?: number; currency?: string };
    revenue += Number(data.amount ?? 0);
    if (data.currency) revenueCurrency = data.currency;
  });

  return {
    newUsers: newUsersSnap.data().count,
    newSubscriptions: newSubsSnap.data().count,
    revenue,
    revenueCurrency,
  };
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export default function AnalyticsPage() {
  const [entries, setEntries] = useState<AnalyticsEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [range, setRange] = useState<DateRange>("30d");
  const [customStart, setCustomStart] = useState(formatRangeDate(new Date(Date.now() - 30 * 86400000)));
  const [customEnd, setCustomEnd] = useState(formatRangeDate(new Date()));

  const [today, setToday] = useState<LiveDeltas>(ZERO_DELTAS);
  const [yesterday, setYesterday] = useState<LiveDeltas>(ZERO_DELTAS);
  const [loadingLive, setLoadingLive] = useState(true);

  const todayDate = todayIst();
  const yesterdayDate = yesterdayIst();

  const dateRange = useMemo(() => {
    if (range === "7d") return { start: formatRangeDate(new Date(Date.now() - 7 * 86400000)), end: formatRangeDate(new Date()) };
    if (range === "30d") return { start: formatRangeDate(new Date(Date.now() - 30 * 86400000)), end: formatRangeDate(new Date()) };
    return { start: customStart, end: customEnd };
  }, [range, customStart, customEnd]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnalytics() {
      setLoadingEntries(true);
      try {
        const q = query(
          collection(db(), "analytics"),
          where("date", ">=", dateRange.start),
          where("date", "<=", dateRange.end),
          orderBy("date", "asc"),
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        setEntries(snap.docs.map((d) => d.data() as AnalyticsEntry));
      } catch (err) {
        console.error("Failed to fetch analytics:", err);
      } finally {
        if (!cancelled) setLoadingEntries(false);
      }
    }
    fetchAnalytics();
    return () => {
      cancelled = true;
    };
  }, [dateRange]);

  const refreshLive = useCallback(async () => {
    setLoadingLive(true);
    try {
      const [t, y] = await Promise.all([fetchLiveDeltas(todayDate), fetchLiveDeltas(yesterdayDate)]);
      setToday(t);
      setYesterday(y);
    } catch (err) {
      console.error("Failed to fetch live deltas:", err);
    } finally {
      setLoadingLive(false);
    }
  }, [todayDate, yesterdayDate]);

  useEffect(() => {
    refreshLive();
  }, [refreshLive]);

  const latest = entries[entries.length - 1];
  const snapshotAsOf = latest?.date ?? "no data yet";

  // Snapshots: latest day in the selected range (do NOT sum these)
  const snapshotCards = [
    { label: `Total Users (as of ${snapshotAsOf} IST)`, value: (latest?.totalUsers ?? 0).toLocaleString(), color: "var(--primary)" },
    { label: `Active Subscriptions (as of ${snapshotAsOf} IST)`, value: (latest?.activeSubscriptions ?? 0).toLocaleString(), color: "var(--warning)" },
    { label: `Published Content (as of ${snapshotAsOf} IST)`, value: (latest?.totalPublishedContent ?? 0).toLocaleString(), color: "var(--success)" },
  ];

  // Range deltas: sum across days in the selected range
  const rangeNewUsers = entries.reduce((acc, e) => acc + (e.newUsers ?? 0), 0);
  const rangeNewSubs = entries.reduce((acc, e) => acc + (e.newSubscriptions ?? 0), 0);
  const rangeRevenue = entries.reduce((acc, e) => acc + (e.revenue ?? 0), 0);
  const rangeRevenueCurrency = entries.find((e) => e.revenueCurrency)?.revenueCurrency ?? "INR";

  const maxRevenue = useMemo(() => Math.max(...entries.map((e) => e.revenue ?? 0), 1), [entries]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Analytics</h1>
            <p className="text-[var(--muted)] mt-1">Day boundaries are IST (Asia/Kolkata).</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={range === "7d" ? "primary" : "secondary"} size="sm" onClick={() => setRange("7d")}>7 Days</Button>
            <Button variant={range === "30d" ? "primary" : "secondary"} size="sm" onClick={() => setRange("30d")}>30 Days</Button>
            <Button variant={range === "custom" ? "primary" : "secondary"} size="sm" onClick={() => setRange("custom")}>Custom</Button>
          </div>
        </div>

        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-3 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">Start Date (IST)</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">End Date (IST)</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
          </div>
        )}

        {/* Today / Yesterday — live deltas */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Daily Deltas</h2>
            <Button variant="ghost" size="sm" onClick={refreshLive} disabled={loadingLive}>
              {loadingLive ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <DeltaPair label="New Users" today={today.newUsers.toLocaleString()} yesterday={yesterday.newUsers.toLocaleString()} todayDate={todayDate} yesterdayDate={yesterdayDate} />
            <DeltaPair label="New Subscriptions" today={today.newSubscriptions.toLocaleString()} yesterday={yesterday.newSubscriptions.toLocaleString()} todayDate={todayDate} yesterdayDate={yesterdayDate} />
            <DeltaPair label="Revenue" today={formatMoney(today.revenue, today.revenueCurrency)} yesterday={formatMoney(yesterday.revenue, yesterday.revenueCurrency)} todayDate={todayDate} yesterdayDate={yesterdayDate} />
          </div>
          <p className="text-xs text-[var(--muted)]">
            Today and yesterday counts are queried live from Firestore and reflect the IST calendar day. They do not depend on the nightly
            aggregator. Revenue counts only transactions with <code>status: "success"</code>.
          </p>
        </div>

        {loadingEntries ? (
          <div className="flex justify-center py-20"><Loader /></div>
        ) : (
          <>
            {/* Snapshots — latest day in the range */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {snapshotCards.map((stat) => (
                <div key={stat.label} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
                  <p className="text-sm text-[var(--muted)]">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1" style={{ color: stat.color }}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Range totals */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <RangeCard label={`New Users · ${dateRange.start} → ${dateRange.end} IST`} value={rangeNewUsers.toLocaleString()} color="var(--success)" />
              <RangeCard label={`New Subscriptions · ${dateRange.start} → ${dateRange.end} IST`} value={rangeNewSubs.toLocaleString()} color="var(--warning)" />
              <RangeCard label={`Revenue · ${dateRange.start} → ${dateRange.end} IST`} value={formatMoney(rangeRevenue, rangeRevenueCurrency)} color="var(--success)" />
            </div>

            {/* Revenue chart */}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4">Revenue per Day (IST)</h2>
              {entries.length === 0 ? (
                <p className="text-[var(--muted)] text-sm text-center py-8">No data for the selected period.</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-end gap-1 h-48">
                    {entries.map((entry) => (
                      <div
                        key={entry.date}
                        className="flex-1 flex flex-col items-center justify-end h-full"
                        title={`${entry.date} IST: ${formatMoney(entry.revenue ?? 0, entry.revenueCurrency ?? rangeRevenueCurrency)}`}
                      >
                        <div
                          className="w-full rounded-t bg-[var(--primary)] hover:bg-[var(--primary-hover)] transition-colors min-h-[2px]"
                          style={{ height: `${((entry.revenue ?? 0) / maxRevenue) * 100}%` }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-xs text-[var(--muted)]">
                    <span>{entries[0]?.date}</span>
                    {entries.length > 2 && <span>{entries[Math.floor(entries.length / 2)]?.date}</span>}
                    <span>{entries[entries.length - 1]?.date}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Daily breakdown */}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)]">
                <h2 className="text-lg font-semibold">Daily Breakdown (IST)</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Date</th>
                      <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">New Users</th>
                      <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">New Subs</th>
                      <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Revenue</th>
                      <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Total Users</th>
                      <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Active Subs</th>
                      <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Published</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-[var(--muted)]">No data available.</td>
                      </tr>
                    ) : (
                      [...entries].reverse().map((entry) => (
                        <tr key={entry.date} className="border-b border-[var(--border)] hover:bg-[var(--card-hover)] transition-colors">
                          <td className="px-4 py-3 font-medium">{entry.date}</td>
                          <td className="px-4 py-3 text-right text-[var(--muted)]">{(entry.newUsers ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-[var(--muted)]">{(entry.newSubscriptions ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-medium text-[var(--success)]">{formatMoney(entry.revenue ?? 0, entry.revenueCurrency ?? rangeRevenueCurrency)}</td>
                          <td className="px-4 py-3 text-right text-[var(--muted)]">{(entry.totalUsers ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-[var(--muted)]">{(entry.activeSubscriptions ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-[var(--muted)]">{(entry.totalPublishedContent ?? 0).toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="px-6 py-3 text-xs text-[var(--muted)] border-t border-[var(--border)]">
                Each row covers IST 00:00 → next IST 00:00. Snapshot columns (Total Users, Active Subs, Published) are taken at IST 00:00 the
                following day, when the aggregator runs.
              </p>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

interface DeltaPairProps {
  label: string;
  today: string;
  yesterday: string;
  todayDate: string;
  yesterdayDate: string;
}

function DeltaPair({ label, today, yesterday, todayDate, yesterdayDate }: DeltaPairProps) {
  return (
    <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl p-4">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <div className="grid grid-cols-2 gap-4 mt-3">
        <div>
          <p className="text-xs text-[var(--muted)]">Today · {todayDate}</p>
          <p className="text-2xl font-bold text-[var(--foreground)] mt-0.5">{today}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)]">Yesterday · {yesterdayDate}</p>
          <p className="text-2xl font-bold text-[var(--muted)] mt-0.5">{yesterday}</p>
        </div>
      </div>
    </div>
  );
}

interface RangeCardProps {
  label: string;
  value: string;
  color: string;
}

function RangeCard({ label, value, color }: RangeCardProps) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
    </div>
  );
}
