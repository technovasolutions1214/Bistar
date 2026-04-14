"use client";
import React, { useEffect, useState, useMemo } from "react";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Button, Loader } from "@novaflix/ui";
import type { AnalyticsEntry } from "@novaflix/shared";

type DateRange = "7d" | "30d" | "custom";

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export default function AnalyticsPage() {
  const [entries, setEntries] = useState<AnalyticsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>("30d");
  const [customStart, setCustomStart] = useState(formatDate(daysAgo(30)));
  const [customEnd, setCustomEnd] = useState(formatDate(new Date()));

  const dateRange = useMemo(() => {
    if (range === "7d") return { start: formatDate(daysAgo(7)), end: formatDate(new Date()) };
    if (range === "30d") return { start: formatDate(daysAgo(30)), end: formatDate(new Date()) };
    return { start: customStart, end: customEnd };
  }, [range, customStart, customEnd]);

  useEffect(() => {
    async function fetchAnalytics() {
      setLoading(true);
      try {
        const q = query(
          collection(db(), "analytics"),
          where("date", ">=", dateRange.start),
          where("date", "<=", dateRange.end),
          orderBy("date", "asc")
        );
        const snap = await getDocs(q);
        setEntries(snap.docs.map((d) => d.data() as AnalyticsEntry));
      } catch (err) {
        console.error("Failed to fetch analytics:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchAnalytics();
  }, [dateRange]);

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, e) => ({
        views: acc.views + e.views,
        signups: acc.signups + e.signups,
        subscriptions: acc.subscriptions + e.subscriptions,
        revenue: acc.revenue + e.revenue,
      }),
      { views: 0, signups: 0, subscriptions: 0, revenue: 0 }
    );
  }, [entries]);

  const maxRevenue = useMemo(() => Math.max(...entries.map((e) => e.revenue), 1), [entries]);

  const statCards = [
    { label: "Total Views", value: totals.views.toLocaleString(), color: "var(--primary)" },
    { label: "New Signups", value: totals.signups.toLocaleString(), color: "var(--success)" },
    { label: "Subscriptions", value: totals.subscriptions.toLocaleString(), color: "var(--warning)" },
    { label: "Revenue", value: `$${totals.revenue.toLocaleString()}`, color: "var(--success)" },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Analytics</h1>
            <p className="text-[var(--muted)] mt-1">Platform performance metrics</p>
          </div>

          {/* Date range picker */}
          <div className="flex items-center gap-2">
            <Button
              variant={range === "7d" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setRange("7d")}
            >
              7 Days
            </Button>
            <Button
              variant={range === "30d" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setRange("30d")}
            >
              30 Days
            </Button>
            <Button
              variant={range === "custom" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setRange("custom")}
            >
              Custom
            </Button>
          </div>
        </div>

        {/* Custom date inputs */}
        {range === "custom" && (
          <div className="flex items-center gap-3 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">Start Date</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1">End Date</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><Loader /></div>
        ) : (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {statCards.map((stat) => (
                <div key={stat.label} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
                  <p className="text-sm text-[var(--muted)]">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1" style={{ color: stat.color }}>
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Chart area (simple bar chart) */}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4">Revenue Trend</h2>
              {entries.length === 0 ? (
                <p className="text-[var(--muted)] text-sm text-center py-8">No data for the selected period.</p>
              ) : (
                <div className="space-y-4">
                  {/* Simple bar chart */}
                  <div className="flex items-end gap-1 h-48">
                    {entries.map((entry, i) => (
                      <div
                        key={i}
                        className="flex-1 flex flex-col items-center justify-end h-full"
                        title={`${entry.date}: $${entry.revenue}`}
                      >
                        <div
                          className="w-full rounded-t bg-[var(--primary)] hover:bg-[var(--primary-hover)] transition-colors min-h-[2px]"
                          style={{ height: `${(entry.revenue / maxRevenue) * 100}%` }}
                        />
                      </div>
                    ))}
                  </div>
                  {/* X-axis labels (show first, middle, last) */}
                  <div className="flex justify-between text-xs text-[var(--muted)]">
                    <span>{entries[0]?.date}</span>
                    {entries.length > 2 && <span>{entries[Math.floor(entries.length / 2)]?.date}</span>}
                    <span>{entries[entries.length - 1]?.date}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Data Table */}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)]">
                <h2 className="text-lg font-semibold">Daily Breakdown</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Date</th>
                      <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Views</th>
                      <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Signups</th>
                      <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Subscriptions</th>
                      <th className="text-right px-4 py-3 text-[var(--muted)] font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-12 text-[var(--muted)]">No data available.</td>
                      </tr>
                    ) : (
                      [...entries].reverse().map((entry) => (
                        <tr key={entry.date} className="border-b border-[var(--border)] hover:bg-[var(--card-hover)] transition-colors">
                          <td className="px-4 py-3 font-medium">{entry.date}</td>
                          <td className="px-4 py-3 text-right text-[var(--muted)]">{entry.views.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-[var(--muted)]">{entry.signups.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-[var(--muted)]">{entry.subscriptions.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-medium text-[var(--success)]">${entry.revenue.toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
