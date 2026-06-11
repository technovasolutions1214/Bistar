"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { MarketingShell } from "@/components/marketing-shell";
import { useAuth } from "@/lib/auth-context";
import { Loader } from "@bistar/ui";

interface AttrRow {
  txnid: string;
  pixelSlug?: string;
  adAccount?: string;
  campaignId?: string;
  adId?: string;
  country?: string;
  value: number; // 0 for marketing (revenue is admin-only); joined from transactions for admins
  capiStatus?: string;
  at: number; // ms
}

const RANGES = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: 0 },
];

// IST (Asia/Kolkata) calendar date, YYYY-MM-DD.
const IST_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function istDate(ms: number): string {
  return ms ? IST_FMT.format(new Date(ms)) : "(unknown)";
}

function tsToMs(ts: unknown): number {
  if (ts && typeof ts === "object") {
    const t = ts as { toDate?: () => Date; seconds?: number };
    if (typeof t.toDate === "function") return t.toDate().getTime();
    if (typeof t.seconds === "number") return t.seconds * 1000;
  }
  return 0;
}

function groupBy(rows: AttrRow[], keyFn: (r: AttrRow) => string | undefined) {
  const m = new Map<string, { count: number; revenue: number }>();
  for (const r of rows) {
    const k = keyFn(r) || "(direct / none)";
    const cur = m.get(k) || { count: 0, revenue: 0 };
    cur.count++;
    cur.revenue += r.value;
    m.set(k, cur);
  }
  return [...m.entries()]
    .map(([k, v]) => ({ k, ...v }))
    .sort((a, b) => b.count - a.count || b.revenue - a.revenue);
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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">No data.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--muted)] text-left">
              <th className="font-medium pb-2">{firstCol}</th>
              <th className="font-medium pb-2 text-right">Purchases</th>
              {showRevenue && <th className="font-medium pb-2 text-right">Revenue</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, max).map((r) => (
              <tr key={r.k} className="border-t border-[var(--border)]">
                <td className="py-2 pr-2 truncate max-w-[220px]">{r.k}</td>
                <td className="py-2 text-right tabular-nums">{r.count}</td>
                {showRevenue && (
                  <td className="py-2 text-right tabular-nums">₹{r.revenue.toLocaleString("en-IN")}</td>
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
  const [rows, setRows] = useState<AttrRow[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("30");
  const [pixelFilter, setPixelFilter] = useState(""); // "" = all pixels

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [attrSnap, pixSnap] = await Promise.all([
        getDocs(query(collection(db(), "attributions"), where("status", "==", "purchased"), limit(2000))),
        getDocs(collection(db(), "pixels")),
      ]);
      const lbl: Record<string, string> = {};
      pixSnap.docs.forEach((d) => {
        lbl[d.id] = (d.data().label as string) || d.id;
      });
      setLabels(lbl);

      // Revenue lives ONLY on the admin-only `transactions` collection. Join it
      // in by txnid for admins; marketing staff never read it (and rules deny).
      const amountByTxn: Record<string, number> = {};
      if (isAdmin) {
        try {
          const txSnap = await getDocs(
            query(collection(db(), "transactions"), where("status", "==", "success"), limit(2000))
          );
          txSnap.docs.forEach((d) => {
            const a = d.data().amount;
            if (typeof a === "number") amountByTxn[d.id] = a;
          });
        } catch (err) {
          console.error("Failed to load revenue:", err);
        }
      }

      setRows(
        attrSnap.docs.map((d) => {
          const x = d.data();
          return {
            txnid: d.id,
            pixelSlug: x.pixelSlug as string | undefined,
            adAccount: x.adAccount as string | undefined,
            campaignId: x.campaignId as string | undefined,
            adId: x.adId as string | undefined,
            country: x.country as string | undefined,
            value: amountByTxn[d.id] ?? 0,
            capiStatus: x.capiStatus as string | undefined,
            at: tsToMs(x.purchasedAt ?? x.createdAt),
          };
        })
      );
    } catch (err) {
      console.error("Failed to load marketing analytics:", err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  // All configured pixels (for the selector), sorted by label.
  const pixelOptions = useMemo(
    () =>
      Object.entries(labels)
        .map(([slug, label]) => ({ slug, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [labels]
  );

  const filtered = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? 0;
    const cutoff = days ? Date.now() - days * 86400000 : 0;
    return rows.filter(
      (r) => (!days || r.at >= cutoff) && (!pixelFilter || r.pixelSlug === pixelFilter)
    );
  }, [rows, range, pixelFilter]);

  const totals = useMemo(() => {
    let revenue = 0;
    const capi = { sent: 0, error: 0, skipped: 0 };
    for (const r of filtered) {
      revenue += r.value;
      if (r.capiStatus === "sent") capi.sent++;
      else if (r.capiStatus === "error") capi.error++;
      else capi.skipped++;
    }
    return { count: filtered.length, revenue, capi };
  }, [filtered]);

  // Date-wise (IST) — most recent day first.
  const byDate = useMemo(() => {
    const m = new Map<string, { count: number; revenue: number }>();
    for (const r of filtered) {
      const k = istDate(r.at);
      const cur = m.get(k) || { count: 0, revenue: 0 };
      cur.count++;
      cur.revenue += r.value;
      m.set(k, cur);
    }
    return [...m.entries()]
      .map(([k, v]) => ({ k, ...v }))
      .sort((a, b) => (a.k < b.k ? 1 : -1));
  }, [filtered]);

  const byPixel = useMemo(
    () => groupBy(filtered, (r) => (r.pixelSlug ? labels[r.pixelSlug] || r.pixelSlug : undefined)),
    [filtered, labels]
  );
  const byAccount = useMemo(() => groupBy(filtered, (r) => r.adAccount), [filtered]);
  const byCampaign = useMemo(() => groupBy(filtered, (r) => r.campaignId), [filtered]);
  const byCountry = useMemo(() => groupBy(filtered, (r) => r.country), [filtered]);

  const selectedPixelLabel = pixelFilter ? labels[pixelFilter] || pixelFilter : null;

  return (
    <MarketingShell>
      {/* Controls: date range + pixel selector */}
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

      {loading ? (
        <div className="py-16 flex justify-center"><Loader /></div>
      ) : (
        <div className="space-y-6">
          {/* Summary — Revenue card is admin-only */}
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

          {/* Date-wise (IST) — scoped to the selected pixel when one is chosen */}
          <Breakdown
            title={selectedPixelLabel ? `By date (IST) — ${selectedPixelLabel}` : "By date (IST)"}
            rows={byDate}
            showRevenue={isAdmin}
            firstCol="Date"
            max={31}
          />

          {/* Source breakdowns — Revenue column is admin-only */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {!pixelFilter && <Breakdown title="By pixel" rows={byPixel} showRevenue={isAdmin} />}
            <Breakdown title="By ad account" rows={byAccount} showRevenue={isAdmin} />
            <Breakdown title="By campaign" rows={byCampaign} showRevenue={isAdmin} />
            <Breakdown title="By country" rows={byCountry} showRevenue={isAdmin} />
          </div>

          <p className="text-xs text-[var(--muted)]">
            {selectedPixelLabel ? `Showing ${selectedPixelLabel}. ` : ""}Dates are IST calendar days. Conversions attributed from captured ad parameters.
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
      {hint && <p className="text-[11px] text-[var(--muted)] mt-1">{hint}</p>}
    </div>
  );
}
