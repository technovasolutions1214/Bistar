"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { MarketingShell } from "@/components/marketing-shell";
import { useAuth } from "@/lib/auth-context";
import {
  Breakdown,
  type BreakdownRow,
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
  daysDescending,
  formatCount,
  formatMoney,
  istDay,
  istToday,
  istTodayMidnightMs,
  percentChange,
} from "@/lib/ist";

// ---------------------------------------------------------------------------
// Marketing conversion analytics.
//
// Data path: past IST days come from the pre-aggregated daily rollups
// (marketingDaily / marketingDailyRevenue — one small doc per day, written by
// the aggregateMarketingDaily function) and TODAY is read live from
// `attributions`. Both are Firestore onSnapshot subscriptions, so the panel
// updates the moment a purchase lands — no refresh, no polling.
//
// Reads stay ~O(days in range) regardless of conversion volume, and never hit
// Firestore's 10k query cap. Revenue stays admin-only at the data layer (its own
// admin-only rollup; today's revenue joins from the admin-only transactions).
//
// Two behaviours worth knowing:
//   * The date list enumerates EVERY day in the range, including today and days
//     with no conversions, so a zero day reads as zero instead of vanishing.
//   * A conversion is bucketed on the IST day its purchase was CONFIRMED
//     (`purchasedAt`, i.e. when the payment webhook fired). The Analytics panel
//     buckets revenue on the day the transaction was CREATED, so around midnight
//     the two panels can legitimately differ by a day.
// ---------------------------------------------------------------------------

const RANGES = [
  { key: "today", label: "Today", days: 1 },
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: 0 },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const MAX_LIVE_DOCS = 2000; // today's attributions; far under Firestore's cap
const TX_CHUNK = 30; // Firestore's max values for an `in` filter
const MAX_TX_CHUNKS = 20; // ⇒ up to 600 same-day conversions joined to revenue
const NONE = "(none)"; // must match the rollup sentinel for a missing dimension
const ALL_TIME_START = "0000-01-01";

let regionNames: Intl.DisplayNames | null = null;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = null;
}
function countryLabel(code: string): string {
  if (code === NONE) return "Unknown";
  try {
    return regionNames?.of(code) ? `${regionNames.of(code)} (${code})` : code;
  } catch {
    return code;
  }
}

function tsToMs(ts: unknown): number {
  if (ts && typeof ts === "object") {
    const t = ts as { toDate?: () => Date; seconds?: number };
    if (typeof t.toDate === "function") return t.toDate().getTime();
    if (typeof t.seconds === "number") return t.seconds * 1000;
  }
  return 0;
}

/* ------------------------------------------------------------ aggregates --- */

type Grp = { count: number; revenue: number };
type Dim = "byPixel" | "byAccount" | "byCampaign" | "byCountry";

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

const DIMS: readonly Dim[] = ["byPixel", "byAccount", "byCampaign", "byCountry"];

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

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/* ------------------------------------------------------------ raw shapes --- */

interface DailyDoc {
  date: string;
  totalCount?: number;
  capi?: { sent?: number; error?: number; skipped?: number };
  byAccount?: Record<string, number>;
  byCampaign?: Record<string, number>;
  byCountry?: Record<string, number>;
  byPixel?: Record<
    string,
    {
      count?: number;
      capi?: { sent?: number; error?: number; skipped?: number };
      byAccount?: Record<string, number>;
      byCampaign?: Record<string, number>;
      byCountry?: Record<string, number>;
    }
  >;
}

interface RevenueDoc {
  date: string;
  totalRevenue?: number;
  byAccount?: Record<string, number>;
  byCampaign?: Record<string, number>;
  byCountry?: Record<string, number>;
  byPixel?: Record<
    string,
    {
      revenue?: number;
      byAccount?: Record<string, number>;
      byCampaign?: Record<string, number>;
      byCountry?: Record<string, number>;
    }
  >;
}

interface LiveAttribution {
  id: string;
  day: string;
  pixelSlug?: string;
  adAccount?: string;
  campaignId?: string;
  country?: string;
  capiKey: "sent" | "error" | "skipped";
}

/** Fold one rollup day (optionally scoped to a pixel) into `agg`. */
function foldRollupDay(
  agg: Agg,
  counts: DailyDoc,
  revenue: RevenueDoc | undefined,
  slug: string | null,
) {
  if (slug) {
    const p = counts.byPixel?.[slug];
    if (!p) return;
    const rp = revenue?.byPixel?.[slug] ?? {};
    const c = num(p.count);
    const r = num(rp.revenue);

    agg.count += c;
    agg.revenue += r;
    agg.capi.sent += num(p.capi?.sent);
    agg.capi.error += num(p.capi?.error);
    agg.capi.skipped += num(p.capi?.skipped);
    addGrp(agg.byDate, counts.date, c, r);
    addGrp(agg.byPixel, slug, c, r);
    for (const [k, n] of Object.entries(p.byAccount ?? {})) addGrp(agg.byAccount, k, n, num(rp.byAccount?.[k]));
    for (const [k, n] of Object.entries(p.byCampaign ?? {})) addGrp(agg.byCampaign, k, n, num(rp.byCampaign?.[k]));
    for (const [k, n] of Object.entries(p.byCountry ?? {})) addGrp(agg.byCountry, k, n, num(rp.byCountry?.[k]));
    return;
  }

  const c = num(counts.totalCount);
  const r = num(revenue?.totalRevenue);
  agg.count += c;
  agg.revenue += r;
  agg.capi.sent += num(counts.capi?.sent);
  agg.capi.error += num(counts.capi?.error);
  agg.capi.skipped += num(counts.capi?.skipped);
  addGrp(agg.byDate, counts.date, c, r);

  for (const [slg, p] of Object.entries(counts.byPixel ?? {}))
    addGrp(agg.byPixel, slg, num(p.count), num(revenue?.byPixel?.[slg]?.revenue));
  for (const [k, n] of Object.entries(counts.byAccount ?? {})) addGrp(agg.byAccount, k, n, num(revenue?.byAccount?.[k]));
  for (const [k, n] of Object.entries(counts.byCampaign ?? {})) addGrp(agg.byCampaign, k, n, num(revenue?.byCampaign?.[k]));
  for (const [k, n] of Object.entries(counts.byCountry ?? {})) addGrp(agg.byCountry, k, n, num(revenue?.byCountry?.[k]));
}

/** Fold one live (today) conversion into `agg`. */
function foldLive(agg: Agg, a: LiveAttribution, revenue: number) {
  agg.count += 1;
  agg.revenue += revenue;
  agg.capi[a.capiKey] += 1;
  addGrp(agg.byDate, a.day, 1, revenue);
  addGrp(agg.byPixel, a.pixelSlug, 1, revenue);
  addGrp(agg.byAccount, a.adAccount, 1, revenue);
  addGrp(agg.byCampaign, a.campaignId, 1, revenue);
  addGrp(agg.byCountry, a.country, 1, revenue);
}

/* ------------------------------------------------------------------ page --- */

export default function MarketingOverviewPage() {
  const { isAdmin } = useAuth();

  const [range, setRange] = useState<RangeKey>("30");
  const [pixelFilter, setPixelFilter] = useState(""); // "" = all pixels

  const [labels, setLabels] = useState<Record<string, string>>({});
  const [rollups, setRollups] = useState<Record<string, DailyDoc>>({});
  const [revenues, setRevenues] = useState<Record<string, RevenueDoc>>({});
  const [live, setLive] = useState<LiveAttribution[]>([]);
  const [liveAmounts, setLiveAmounts] = useState<Record<string, number>>({});

  const [ready, setReady] = useState({ rollups: false, live: false });
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = istToday();
  const days = RANGES.find((r) => r.key === range)?.days ?? 0;

  // Current window, plus the same-length window before it for the KPI deltas.
  const { windowStart, prevStart, prevEnd, subscribeFrom } = useMemo(() => {
    if (!days) {
      return { windowStart: ALL_TIME_START, prevStart: null, prevEnd: null, subscribeFrom: ALL_TIME_START };
    }
    const start = addDays(today, -(days - 1));
    return {
      windowStart: start,
      prevStart: addDays(start, -days),
      prevEnd: addDays(start, -1),
      subscribeFrom: addDays(start, -days),
    };
  }, [days, today]);

  const touch = useCallback(() => setUpdatedAt(Date.now()), []);
  const fail = useCallback((scope: string, err: unknown) => {
    console.error(`Marketing analytics (${scope}):`, err);
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  /* --- pixels (live) --- */
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db(), "pixels"),
      (snap) => {
        const next: Record<string, string> = {};
        snap.forEach((d) => {
          next[d.id] = (d.data().label as string) || d.id;
        });
        setLabels(next);
        touch();
      },
      (err) => fail("pixels", err),
    );
    return unsub;
  }, [touch, fail]);

  /* --- past days: count rollups (live) --- */
  useEffect(() => {
    setReady((r) => ({ ...r, rollups: false }));
    const unsub = onSnapshot(
      query(
        collection(db(), "marketingDaily"),
        where("date", ">=", subscribeFrom),
        where("date", "<", today),
        orderBy("date", "desc"),
      ),
      (snap) => {
        const next: Record<string, DailyDoc> = {};
        snap.forEach((d) => {
          next[d.id] = d.data() as DailyDoc;
        });
        setRollups(next);
        setReady((r) => ({ ...r, rollups: true }));
        touch();
      },
      (err) => {
        fail("daily rollups", err);
        setReady((r) => ({ ...r, rollups: true }));
      },
    );
    return unsub;
  }, [subscribeFrom, today, touch, fail]);

  /* --- past days: revenue rollups (live, admin only) --- */
  useEffect(() => {
    if (!isAdmin) {
      setRevenues({});
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db(), "marketingDailyRevenue"),
        where("date", ">=", subscribeFrom),
        where("date", "<", today),
        orderBy("date", "desc"),
      ),
      (snap) => {
        const next: Record<string, RevenueDoc> = {};
        snap.forEach((d) => {
          next[d.id] = d.data() as RevenueDoc;
        });
        setRevenues(next);
        touch();
      },
      (err) => fail("revenue rollups", err),
    );
    return unsub;
  }, [isAdmin, subscribeFrom, today, touch, fail]);

  /* --- today: live conversions --- */
  useEffect(() => {
    setReady((r) => ({ ...r, live: false }));
    const unsub = onSnapshot(
      query(
        collection(db(), "attributions"),
        where("purchasedAt", ">=", Timestamp.fromMillis(istTodayMidnightMs())),
        orderBy("purchasedAt", "desc"),
        limit(MAX_LIVE_DOCS),
      ),
      (snap) => {
        setLive(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              id: d.id,
              day: istDay(tsToMs(x.purchasedAt)),
              pixelSlug: (x.pixelSlug as string | undefined) || undefined,
              adAccount: (x.adAccount as string | undefined) || undefined,
              campaignId: (x.campaignId as string | undefined) || undefined,
              country: (x.country as string | undefined) || undefined,
              capiKey: x.capiStatus === "sent" ? "sent" : x.capiStatus === "error" ? "error" : "skipped",
            };
          }),
        );
        setReady((r) => ({ ...r, live: true }));
        touch();
      },
      (err) => {
        fail("today's conversions", err);
        setReady((r) => ({ ...r, live: true }));
      },
    );
    return unsub;
  }, [touch, fail]);

  /* --- today: revenue, joined by transaction id (admin only) ---
   *
   * The attribution doc id IS the transaction id, so we look the transactions up
   * directly instead of scanning a createdAt window. The old code queried
   * `transactions` where createdAt >= today-2d, which silently dropped revenue
   * for any checkout that was created more than two days before it succeeded —
   * the purchase counted, the rupees didn't. */
  const liveIdKey = useMemo(() => live.map((a) => a.id).sort().join(","), [live]);
  useEffect(() => {
    if (!isAdmin || !liveIdKey) {
      setLiveAmounts({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ids = liveIdKey.split(",");
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length && chunks.length < MAX_TX_CHUNKS; i += TX_CHUNK) {
          chunks.push(ids.slice(i, i + TX_CHUNK));
        }
        const snaps = await Promise.all(
          chunks.map((c) =>
            getDocs(query(collection(db(), "transactions"), where(documentId(), "in", c))),
          ),
        );
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const snap of snaps) {
          snap.forEach((d) => {
            const x = d.data();
            if (x.status === "success" && typeof x.amount === "number") next[d.id] = x.amount;
          });
        }
        setLiveAmounts(next);
        touch();
      } catch (err) {
        if (!cancelled) fail("today's revenue", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, liveIdKey, touch, fail]);

  /* --------------------------------------------------------- aggregation --- */

  const slug = pixelFilter || null;

  const build = useCallback(
    (from: string, to: string, includeToday: boolean): Agg => {
      const agg = emptyAgg();
      for (const [date, doc] of Object.entries(rollups)) {
        if (date < from || date > to) continue;
        foldRollupDay(agg, doc, revenues[date], slug);
      }
      if (includeToday) {
        for (const a of live) {
          if (slug && (a.pixelSlug || NONE) !== slug) continue;
          foldLive(agg, a, liveAmounts[a.id] ?? 0);
        }
      }
      return agg;
    },
    [rollups, revenues, live, liveAmounts, slug],
  );

  const current = useMemo(
    () => build(windowStart, today, true),
    [build, windowStart, today],
  );
  const previous = useMemo(
    () => (prevStart && prevEnd ? build(prevStart, prevEnd, false) : null),
    [build, prevStart, prevEnd],
  );

  /* ------------------------------------------------------------- derived --- */

  const loading = !ready.rollups || !ready.live;

  // Every day in the range, newest first — including today and empty days.
  const dayRows = useMemo(() => {
    const start =
      days > 0
        ? windowStart
        : Object.keys(current.byDate).sort()[0] ?? today;
    return daysDescending(start, today).map((date) => ({
      date,
      count: current.byDate[date]?.count ?? 0,
      revenue: current.byDate[date]?.revenue ?? 0,
    }));
  }, [days, windowStart, today, current.byDate]);

  const chartData = useMemo(
    () => [...dayRows].reverse().map((d) => ({ date: d.date, value: d.count })),
    [dayRows],
  );

  const rows = useCallback(
    (dim: Dim, label?: (k: string) => string): BreakdownRow[] =>
      Object.entries(current[dim])
        .map(([k, g]) => ({
          key: k,
          label: k === NONE ? "(direct / none)" : label ? label(k) : k,
          count: g.count,
          revenue: g.revenue,
        }))
        .sort((a, b) => b.count - a.count || b.revenue - a.revenue),
    [current],
  );

  const byPixel = useMemo(() => rows("byPixel", (s) => labels[s] || s), [rows, labels]);
  const byAccount = useMemo(() => rows("byAccount"), [rows]);
  const byCampaign = useMemo(() => rows("byCampaign"), [rows]);
  const byCountry = useMemo(() => rows("byCountry", countryLabel), [rows]);

  const pixelOptions = useMemo(
    () =>
      Object.entries(labels)
        .map(([s, label]) => ({ slug: s, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [labels],
  );
  const selectedPixelLabel = pixelFilter ? labels[pixelFilter] || pixelFilter : null;

  const capiIssues = current.capi.error + current.capi.skipped;
  const noPixels = pixelOptions.length === 0;
  const avgOrder = current.count ? current.revenue / current.count : 0;
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? "";
  const comparisonHint = previous ? `vs previous ${rangeLabel.toLowerCase()}` : "no prior period";

  /* ---------------------------------------------------------------- view --- */

  return (
    <MarketingShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <RangeTabs options={RANGES} value={range} onChange={setRange} />
          <LiveStatus updatedAt={updatedAt} live={!loading} error={error} />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="pixel-filter" className="sr-only">
            Filter by pixel
          </label>
          <select
            id="pixel-filter"
            value={pixelFilter}
            onChange={(e) => setPixelFilter(e.target.value)}
            disabled={noPixels}
            className="max-w-[260px] rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="">{noPixels ? "No pixels configured" : "All pixels"}</option>
            {pixelOptions.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="mb-5"><ErrorBanner message={`Couldn't load analytics: ${error}`} /></div>}

      {noPixels && !loading && (
        <div className="mb-5 rounded-xl border border-[var(--warning)]/25 bg-[var(--warning)]/10 px-4 py-3 text-sm">
          <p className="font-medium text-[var(--warning)]">No Meta pixel is configured</p>
          <p className="mt-1 text-[var(--muted)]">
            Purchases and revenue below are complete, but every conversion falls under
            &ldquo;(direct / none)&rdquo; and no Conversions API event can be sent. Add one on the{" "}
            <a href="/marketing/pixels" className="underline hover:text-[var(--foreground)]">
              Pixels
            </a>{" "}
            tab, then point ad URLs at <code className="text-xs">?c=&lt;slug&gt;</code>.
          </p>
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          <SkeletonCards count={isAdmin ? 4 : 3} />
          <SkeletonPanel rows={6} />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Purchases"
              value={formatCount(current.count)}
              delta={previous ? percentChange(current.count, previous.count) : undefined}
              hint={comparisonHint}
            />
            {isAdmin && (
              <StatCard
                label="Revenue"
                value={formatMoney(current.revenue)}
                delta={previous ? percentChange(current.revenue, previous.revenue) : undefined}
                hint={comparisonHint}
                tone="success"
              />
            )}
            {isAdmin && (
              <StatCard
                label="Avg. order value"
                value={current.count ? formatMoney(avgOrder) : "—"}
                hint={`${formatCount(current.count)} purchase${current.count === 1 ? "" : "s"}`}
              />
            )}
            <StatCard
              label="CAPI delivered"
              value={formatCount(current.capi.sent)}
              hint={
                capiIssues
                  ? `${formatCount(current.capi.error)} error · ${formatCount(current.capi.skipped)} skipped`
                  : "all events delivered"
              }
              tone={current.capi.sent > 0 ? "success" : capiIssues > 0 ? "warning" : "default"}
            />
          </div>

          <Panel
            title={
              selectedPixelLabel
                ? `Conversions per day — ${selectedPixelLabel}`
                : "Conversions per day"
            }
            subtitle="IST calendar days. Today updates live; earlier days come from the nightly rollup."
            bodyClassName="pt-1"
          >
            <DailyBarChart
              data={chartData}
              format={(n) => `${formatCount(n)} conv.`}
              todayDate={today}
              label="Conversions per IST day"
            />
          </Panel>

          <Panel
            title="Daily breakdown (IST)"
            actions={
              <span className="text-xs text-[var(--muted)]">
                {dayRows.length} day{dayRows.length === 1 ? "" : "s"}
              </span>
            }
          >
            {dayRows.length === 0 ? (
              <EmptyState title="No days in this range." />
            ) : (
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Conversions and revenue per IST day</caption>
                  <thead className="sticky top-0 z-10 bg-[var(--card)]">
                    <tr className="text-left text-xs text-[var(--muted)]">
                      <th scope="col" className="border-b border-[var(--border)] px-5 py-2.5 font-medium">
                        Date
                      </th>
                      <th scope="col" className="border-b border-[var(--border)] px-3 py-2.5 text-right font-medium">
                        Conversions
                      </th>
                      {isAdmin && (
                        <th scope="col" className="border-b border-[var(--border)] px-5 py-2.5 text-right font-medium">
                          Revenue
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {dayRows.map((d) => (
                      <tr
                        key={d.date}
                        className={`border-b border-[var(--border)] last:border-0 transition-colors hover:bg-[var(--card-hover)] ${
                          d.date === today ? "bg-[var(--primary)]/[0.06]" : ""
                        }`}
                      >
                        <td className="px-5 py-2.5">
                          <DayCell date={d.date} todayDate={today} />
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right tabular-nums ${
                            d.count ? "" : "text-[var(--muted)]/50"
                          }`}
                        >
                          {formatCount(d.count)}
                        </td>
                        {isAdmin && (
                          <td
                            className={`px-5 py-2.5 text-right tabular-nums ${
                              d.revenue ? "text-[var(--success)]" : "text-[var(--muted)]/50"
                            }`}
                          >
                            {formatMoney(d.revenue)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {!pixelFilter && (
              <Breakdown
                title="By pixel"
                rows={byPixel}
                showRevenue={isAdmin}
                formatRevenue={(n) => formatMoney(n)}
                emptyHint="Configure a pixel and tag ad URLs with ?c=<slug>."
              />
            )}
            <Breakdown
              title="By ad account"
              rows={byAccount}
              showRevenue={isAdmin}
              formatRevenue={(n) => formatMoney(n)}
              emptyHint="Add &acct=<id> to your ad destination URLs."
            />
            <Breakdown
              title="By campaign"
              rows={byCampaign}
              showRevenue={isAdmin}
              formatRevenue={(n) => formatMoney(n)}
              emptyHint="Add Meta's &campaign_id={{campaign.id}} macro to ad URLs."
            />
            <Breakdown
              title="By country"
              rows={byCountry}
              firstCol="Country"
              showRevenue={isAdmin}
              formatRevenue={(n) => formatMoney(n)}
              emptyHint="Country is resolved at checkout from the visitor's device."
            />
          </div>

          <p className="text-xs leading-relaxed text-[var(--muted)]">
            {selectedPixelLabel ? `Showing ${selectedPixelLabel}. ` : ""}
            Conversions are bucketed on the IST day the payment was confirmed, so this panel can
            differ from Analytics (which buckets revenue on the day the transaction was created) for
            payments that straddle midnight.
            {isAdmin
              ? " Ad spend / ROAS would require the Meta Marketing API and isn't included here."
              : " Revenue figures are admin-only."}
          </p>
        </div>
      )}
    </MarketingShell>
  );
}
