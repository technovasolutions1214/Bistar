"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, orderBy, limit, Timestamp } from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { MarketingShell } from "@/components/marketing-shell";
import { useAuth } from "@/lib/auth-context";
import { Loader } from "@bistar/ui";

// ---------------------------------------------------------------------------
// Scalable marketing analytics. Past IST days are read from pre-aggregated
// daily rollups (marketingDaily / marketingDailyRevenue — one small doc per
// day, written by the aggregateMarketingDaily function), and TODAY is read
// live from `attributions` (a bounded query). So the dashboard reads ≈
// window-days docs + today, never thousands of raw conversions, and never hits
// Firestore's 10k query cap. Revenue stays admin-only at the data layer
// (separate admin-only revenue rollup; live today's revenue joins from
// admin-only transactions).
// ---------------------------------------------------------------------------

const RANGES = [
  { key: "today", label: "Today", days: 1 },
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: 0 },
];

const MAX_DOCS = 10000; // Firestore's hard query-limit; only today/live uses it, well under.
const DAY_MS = 86400000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const NONE = "(none)"; // must match the rollup sentinel for a missing dimension

// IST calendar date (YYYY-MM-DD) for a UTC instant.
function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}
// IST midnight of *today* as a UTC instant (ms).
function istTodayMidnightMs(): number {
  return new Date(`${istDay(Date.now())}T00:00:00+05:30`).getTime();
}

function tsToMs(ts: unknown): number {
  if (ts && typeof ts === "object") {
    const t = ts as { toDate?: () => Date; seconds?: number };
    if (typeof t.toDate === "function") return t.toDate().getTime();
    if (typeof t.seconds === "number") return t.seconds * 1000;
  }
  return 0;
}

type Grp = { count: number; revenue: number };
interface Agg {
  count: number;
  revenue: number;
  capi: { sent: number; error: number; skipped: number };
  byDate: Record<string, Grp>;
  byPixel: Record<string, Grp>;
  byAccount: Record<string, Grp>;
  byCampaign: Record<string, Grp>;
  byCountry: Record<string, Grp>;
}
const emptyAgg = (): Agg => ({
  count: 0,
  revenue: 0,
  capi: { sent: 0, error: 0, skipped: 0 },
  byDate: {},
  byPixel: {},
  byAccount: {},
  byCampaign: {},
  byCountry: {},
});
function addGrp(m: Record<string, Grp>, key: string | undefined, count: number, revenue: number) {
  const k = key || NONE;
  const g = m[k] || (m[k] = { count: 0, revenue: 0 });
  g.count += count;
  g.revenue += revenue;
}
function mergeAgg(a: Agg, b: Agg): Agg {
  const m = emptyAgg();
  for (const src of [a, b]) {
    m.count += src.count;
    m.revenue += src.revenue;
    m.capi.sent += src.capi.sent;
    m.capi.error += src.capi.error;
    m.capi.skipped += src.capi.skipped;
    (["byDate", "byPixel", "byAccount", "byCampaign", "byCountry"] as const).forEach((dim) => {
      for (const [k, g] of Object.entries(src[dim])) addGrp(m[dim], k, g.count, g.revenue);
    });
  }
  return m;
}

// TODAY (and the Today range): live, bounded query of today's purchased
// attributions; pixel filter applied client-side (today's volume is small).
async function liveAgg(cutoffMs: number, slug: string | null, isAdmin: boolean): Promise<Agg> {
  const attrSnap = await getDocs(
    query(
      collection(db(), "attributions"),
      where("purchasedAt", ">=", Timestamp.fromMillis(cutoffMs)),
      orderBy("purchasedAt", "desc"),
      limit(MAX_DOCS),
    ),
  );
  const amt: Record<string, number> = {};
  if (isAdmin && !attrSnap.empty) {
    const txSnap = await getDocs(
      query(
        collection(db(), "transactions"),
        where("createdAt", ">=", Timestamp.fromMillis(Math.max(0, cutoffMs - 2 * DAY_MS))),
        orderBy("createdAt", "desc"),
        limit(MAX_DOCS),
      ),
    );
    txSnap.forEach((d) => {
      const x = d.data();
      if (x.status === "success" && typeof x.amount === "number") amt[d.id] = x.amount as number;
    });
  }
  const agg = emptyAgg();
  attrSnap.forEach((d) => {
    const x = d.data();
    const pixel = (x.pixelSlug as string | undefined) || NONE;
    if (slug && pixel !== slug) return;
    const rev = amt[d.id] || 0;
    const capiKey = x.capiStatus === "sent" ? "sent" : x.capiStatus === "error" ? "error" : "skipped";
    agg.count++;
    agg.revenue += rev;
    agg.capi[capiKey]++;
    addGrp(agg.byDate, istDay(tsToMs(x.purchasedAt)), 1, rev);
    addGrp(agg.byPixel, pixel, 1, rev);
    addGrp(agg.byAccount, x.adAccount as string | undefined, 1, rev);
    addGrp(agg.byCampaign, x.campaignId as string | undefined, 1, rev);
    addGrp(agg.byCountry, x.country as string | undefined, 1, rev);
  });
  return agg;
}

// Past IST days from the daily rollups. With a pixel filter, reads that pixel's
// nested slice; otherwise the top-level totals. Revenue only for admins.
async function rollupAgg(
  startDate: string,
  todayDate: string,
  slug: string | null,
  isAdmin: boolean,
): Promise<Agg> {
  const cntSnap = await getDocs(
    query(
      collection(db(), "marketingDaily"),
      where("date", ">=", startDate),
      where("date", "<", todayDate),
      orderBy("date", "desc"),
    ),
  );
  const revByDate: Record<string, Record<string, unknown>> = {};
  if (isAdmin) {
    const revSnap = await getDocs(
      query(
        collection(db(), "marketingDailyRevenue"),
        where("date", ">=", startDate),
        where("date", "<", todayDate),
        orderBy("date", "desc"),
      ),
    );
    revSnap.forEach((d) => {
      revByDate[d.id] = d.data();
    });
  }
  const agg = emptyAgg();
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  cntSnap.forEach((d) => {
    const c = d.data() as Record<string, unknown>;
    const r = revByDate[d.id] || {};
    if (slug) {
      const p = ((c.byPixel as Record<string, never>) || {})[slug] as
        | { count?: number; capi?: { sent?: number; error?: number; skipped?: number }; byAccount?: Record<string, number>; byCampaign?: Record<string, number>; byCountry?: Record<string, number> }
        | undefined;
      if (!p) return;
      const rp = (((r.byPixel as Record<string, never>) || {})[slug] || {}) as {
        revenue?: number;
        byAccount?: Record<string, number>;
        byCampaign?: Record<string, number>;
        byCountry?: Record<string, number>;
      };
      agg.count += num(p.count);
      agg.revenue += num(rp.revenue);
      agg.capi.sent += num(p.capi?.sent);
      agg.capi.error += num(p.capi?.error);
      agg.capi.skipped += num(p.capi?.skipped);
      addGrp(agg.byDate, c.date as string, num(p.count), num(rp.revenue));
      addGrp(agg.byPixel, slug, num(p.count), num(rp.revenue));
      for (const [k, n] of Object.entries(p.byAccount || {})) addGrp(agg.byAccount, k, n, num(rp.byAccount?.[k]));
      for (const [k, n] of Object.entries(p.byCampaign || {})) addGrp(agg.byCampaign, k, n, num(rp.byCampaign?.[k]));
      for (const [k, n] of Object.entries(p.byCountry || {})) addGrp(agg.byCountry, k, n, num(rp.byCountry?.[k]));
    } else {
      const capi = (c.capi as { sent?: number; error?: number; skipped?: number }) || {};
      agg.count += num(c.totalCount);
      agg.revenue += num(r.totalRevenue);
      agg.capi.sent += num(capi.sent);
      agg.capi.error += num(capi.error);
      agg.capi.skipped += num(capi.skipped);
      addGrp(agg.byDate, c.date as string, num(c.totalCount), num(r.totalRevenue));
      const revPixel = (r.byPixel as Record<string, { revenue?: number }>) || {};
      for (const [slg, p] of Object.entries((c.byPixel as Record<string, { count?: number }>) || {}))
        addGrp(agg.byPixel, slg, num(p.count), num(revPixel[slg]?.revenue));
      for (const [k, n] of Object.entries((c.byAccount as Record<string, number>) || {}))
        addGrp(agg.byAccount, k, n, num((r.byAccount as Record<string, number>)?.[k]));
      for (const [k, n] of Object.entries((c.byCampaign as Record<string, number>) || {}))
        addGrp(agg.byCampaign, k, n, num((r.byCampaign as Record<string, number>)?.[k]));
      for (const [k, n] of Object.entries((c.byCountry as Record<string, number>) || {}))
        addGrp(agg.byCountry, k, n, num((r.byCountry as Record<string, number>)?.[k]));
    }
  });
  return agg;
}

function Breakdown({
  title,
  rows,
  showRevenue,
  firstCol = "Source",
  max = 12,
}: {
  title: string;
  rows: { k: string; count: number; revenue: number }[];
  showRevenue: boolean;
  firstCol?: string;
  max?: number;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)] text-sm font-semibold">{title}</div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-[var(--muted)]">No data.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)]">
              <th className="px-4 py-2 font-medium">{firstCol}</th>
              <th className="px-4 py-2 font-medium text-right">Conv.</th>
              {showRevenue && <th className="px-4 py-2 font-medium text-right">Revenue</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, max).map((r) => (
              <tr key={r.k} className="border-t border-[var(--border)]">
                <td className="px-4 py-2 truncate max-w-[220px]">{r.k}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.count.toLocaleString("en-IN")}</td>
                {showRevenue && (
                  <td className="px-4 py-2 text-right tabular-nums">₹{r.revenue.toLocaleString("en-IN")}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function MarketingOverviewPage() {
  const { isAdmin } = useAuth();
  const [agg, setAgg] = useState<Agg | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("today");
  const [pixelFilter, setPixelFilter] = useState(""); // "" = all pixels
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const pixSnap = await getDocs(collection(db(), "pixels"));
      const lbl: Record<string, string> = {};
      pixSnap.forEach((d) => {
        lbl[d.id] = (d.data().label as string) || d.id;
      });
      setLabels(lbl);

      const days = RANGES.find((r) => r.key === range)?.days ?? 0;
      const todayMid = istTodayMidnightMs();
      const todayDate = istDay(Date.now());
      const slug = pixelFilter || null;

      let result: Agg;
      if (range === "today") {
        result = await liveAgg(todayMid, slug, isAdmin);
      } else {
        const startDate = days ? istDay(todayMid - (days - 1) * DAY_MS) : "0000-01-01";
        const [past, today] = await Promise.all([
          rollupAgg(startDate, todayDate, slug, isAdmin),
          liveAgg(todayMid, slug, isAdmin),
        ]);
        result = mergeAgg(past, today);
      }
      setAgg(result);
      setUpdatedAt(Date.now());
    } catch (err) {
      console.error("Failed to load marketing analytics:", err);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [range, pixelFilter, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const pixelOptions = useMemo(
    () =>
      Object.entries(labels)
        .map(([slug, label]) => ({ slug, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [labels],
  );

  const sortRows = (m: Record<string, Grp>, label?: (k: string) => string) =>
    Object.entries(m)
      .map(([k, g]) => ({ k: k === NONE ? "(direct / none)" : label ? label(k) : k, count: g.count, revenue: g.revenue }))
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue);

  const totals = agg ?? emptyAgg();
  const byDate = useMemo(
    () =>
      Object.entries(agg?.byDate ?? {})
        .map(([k, g]) => ({ k, count: g.count, revenue: g.revenue }))
        .sort((a, b) => (a.k < b.k ? 1 : -1)),
    [agg],
  );
  const byPixel = useMemo(() => sortRows(agg?.byPixel ?? {}, (s) => labels[s] || s), [agg, labels]);
  const byAccount = useMemo(() => sortRows(agg?.byAccount ?? {}), [agg]);
  const byCampaign = useMemo(() => sortRows(agg?.byCampaign ?? {}), [agg]);
  const byCountry = useMemo(() => sortRows(agg?.byCountry ?? {}), [agg]);
  const selectedPixelLabel = pixelFilter ? labels[pixelFilter] || pixelFilter : null;

  return (
    <MarketingShell>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === r.key
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card)]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && (
            <span className="text-xs text-[var(--muted)] whitespace-nowrap">
              Updated{" "}
              {new Date(updatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })} IST
            </span>
          )}
          <button
            onClick={() => load()}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--card)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <select
            value={pixelFilter}
            onChange={(e) => setPixelFilter(e.target.value)}
            className="bg-[var(--card)] border border-[var(--border)] text-sm rounded-lg px-3 py-1.5 max-w-[260px]"
          >
            <option value="">All pixels</option>
            {pixelOptions.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadError && (
        <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          Couldn&apos;t load analytics: {loadError}
        </div>
      )}

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card label="Purchases" value={totals.count.toLocaleString("en-IN")} />
            {isAdmin && <Card label="Revenue" value={`₹${totals.revenue.toLocaleString("en-IN")}`} />}
            <Card label="CAPI sent" value={totals.capi.sent.toLocaleString("en-IN")} />
            <Card
              label="CAPI issues"
              value={(totals.capi.error + totals.capi.skipped).toLocaleString("en-IN")}
              hint={`${totals.capi.error} error · ${totals.capi.skipped} skipped`}
            />
          </div>

          <Breakdown
            title={selectedPixelLabel ? `By date (IST) — ${selectedPixelLabel}` : "By date (IST)"}
            rows={byDate}
            showRevenue={isAdmin}
            firstCol="Date"
            max={92}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {!pixelFilter && <Breakdown title="By pixel" rows={byPixel} showRevenue={isAdmin} />}
            <Breakdown title="By ad account" rows={byAccount} showRevenue={isAdmin} />
            <Breakdown title="By campaign" rows={byCampaign} showRevenue={isAdmin} />
            <Breakdown title="By country" rows={byCountry} showRevenue={isAdmin} />
          </div>

          <p className="text-xs text-[var(--muted)]">
            {selectedPixelLabel ? `Showing ${selectedPixelLabel}. ` : ""}Today is live; earlier IST days come
            from daily rollups, so totals stay accurate at any volume.
            {isAdmin
              ? " Ad spend / ROAS would require the Meta Marketing API and isn't included here."
              : " Revenue figures are admin-only."}
          </p>
        </div>
      )}
    </MarketingShell>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {hint && <p className="text-xs text-[var(--muted)] mt-1">{hint}</p>}
    </div>
  );
}
