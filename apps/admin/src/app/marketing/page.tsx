"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { MarketingShell } from "@/components/marketing-shell";
import { useAuth } from "@/lib/auth-context";
import { Loader } from "@novaflix/ui";

interface AttrRow {
  pixelSlug?: string;
  adAccount?: string;
  campaignId?: string;
  adId?: string;
  country?: string;
  value: number;
  capiStatus?: string;
  at: number; // ms
}

const RANGES = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: 0 },
];

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
}: {
  title: string;
  rows: { k: string; count: number; revenue: number }[];
  showRevenue: boolean;
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
              <th className="font-medium pb-2">Source</th>
              <th className="font-medium pb-2 text-right">Purchases</th>
              {showRevenue && <th className="font-medium pb-2 text-right">Revenue</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r) => (
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
      setRows(
        attrSnap.docs.map((d) => {
          const x = d.data();
          return {
            pixelSlug: x.pixelSlug as string | undefined,
            adAccount: x.adAccount as string | undefined,
            campaignId: x.campaignId as string | undefined,
            adId: x.adId as string | undefined,
            country: x.country as string | undefined,
            value: typeof x.value === "number" ? x.value : 0,
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? 0;
    if (!days) return rows;
    const cutoff = Date.now() - days * 86400000;
    return rows.filter((r) => r.at >= cutoff);
  }, [rows, range]);

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

  const byPixel = useMemo(
    () => groupBy(filtered, (r) => (r.pixelSlug ? labels[r.pixelSlug] || r.pixelSlug : undefined)),
    [filtered, labels]
  );
  const byAccount = useMemo(() => groupBy(filtered, (r) => r.adAccount), [filtered]);
  const byCampaign = useMemo(() => groupBy(filtered, (r) => r.campaignId), [filtered]);
  const byCountry = useMemo(() => groupBy(filtered, (r) => r.country), [filtered]);

  return (
    <MarketingShell>
      {/* Range selector */}
      <div className="flex items-center gap-1 mb-5">
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

          {/* Breakdowns — Revenue column is admin-only */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Breakdown title="By pixel" rows={byPixel} showRevenue={isAdmin} />
            <Breakdown title="By ad account" rows={byAccount} showRevenue={isAdmin} />
            <Breakdown title="By campaign" rows={byCampaign} showRevenue={isAdmin} />
            <Breakdown title="By country" rows={byCountry} showRevenue={isAdmin} />
          </div>

          <p className="text-xs text-[var(--muted)]">
            Conversions attributed from captured ad parameters.
            {isAdmin
              ? " Ad spend / ROAS would require the Meta Marketing API and isn't included here."
              : " Revenue figures are visible to admins only."}
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
