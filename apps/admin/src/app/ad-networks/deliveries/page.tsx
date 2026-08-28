"use client";
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { auth, db } from "@bistar/firebase-config";
import { AdNetworksShell } from "@/components/ad-networks-shell";
import { AD_NETWORKS, EVENT_CATALOG, type AdEventKey } from "@/lib/ad-networks";
import { Button, Loader, useToast } from "@bistar/ui";

/**
 * Deliveries — every postback we have queued, with the exact URL we sent and
 * the exact answer we got back.
 *
 * This is the tab to open when a network says "we see no conversions": it
 * distinguishes "we never fired" (no row), "we fired and they rejected it"
 * (status failed + their response body) and "we fired and they accepted it"
 * (status sent) — three situations that look identical from the network's
 * dashboard.
 */

const PAGE_SIZE = 200;

interface Delivery {
  id: string;
  network?: string;
  event?: AdEventKey;
  status?: string;
  skipReason?: string;
  clickId?: string;
  conversionId?: string;
  txnid?: string | null;
  url?: string;
  method?: string;
  requestBody?: string | null;
  httpStatus?: number | null;
  responseSnippet?: string;
  error?: string | null;
  payout?: number | null;
  payoutCurrency?: string;
  goal?: string | null;
  revenue?: number | null;
  revenueCurrency?: string | null;
  unknownMacros?: string[];
  source?: string;
  attempt?: number;
  tries?: number;
  durationMs?: number;
  dryRun?: boolean;
  retryPending?: boolean;
  parentId?: string;
  dryRunOriginal?: boolean;
  zone?: string | null;
  campaign?: string | null;
  creative?: string | null;
  country?: string | null;
  createdAt?: { toDate?: () => Date };
  sentAt?: { toDate?: () => Date };
  nextRetryAt?: { toDate?: () => Date };
}

const STATUS_TONE: Record<string, string> = {
  sent: "bg-[var(--success)]/15 text-[var(--success)]",
  failed: "bg-[var(--danger)]/15 text-[var(--danger)]",
  queued: "bg-[var(--warning)]/15 text-[var(--warning)]",
  // Claimed by the delivery function and in flight. A row stuck here is
  // rescued by the retry sweeper after 15 minutes.
  sending: "bg-[var(--warning)]/15 text-[var(--warning)]",
  skipped: "bg-[var(--muted)]/15 text-[var(--muted)]",
};

/** Plain-English meaning of every reason the engine can decline to send. */
const SKIP_REASON: Record<string, string> = {
  "dry-run": "Preview only — nothing was sent to the network.",
  "unknown-network": "A visitor arrived with ?net= pointing at a network that has no config here. Check the landing URL in that campaign.",
  "network-disabled": "The network is switched off in the Networks tab.",
  "event-disabled": "This event is switched off for this network in the Events tab.",
  "no-postback-url": "No postback URL is saved for this network.",
  "malformed-row": "The queued row was missing its network or event — this should not happen; report it.",
};

const SOURCE_LABEL: Record<string, string> = {
  "purchase-trigger": "Purchase (server-verified)",
  "event-api": "Browser event",
  "manual-test": "Manual test",
  retry: "Retry",
};

function fmtTime(t?: { toDate?: () => Date }): string {
  const d = t?.toDate?.();
  if (!d) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <div className="text-xs font-mono break-all mt-0.5">{children}</div>
    </div>
  );
}

function Row({ d, onRetry }: { d: Delivery; onRetry: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const tone = STATUS_TONE[d.status || ""] || STATUS_TONE.skipped;
  const label = d.dryRun && d.status === "skipped" ? "preview" : d.status || "—";
  const net = AD_NETWORKS.find((n) => n.slug === d.network);

  return (
    <>
      <tr className="hover:bg-[var(--card-hover)] transition-colors cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <td className="px-4 py-3 text-sm text-[var(--muted)] whitespace-nowrap">{fmtTime(d.createdAt)}</td>
        <td className="px-4 py-3 text-sm">{net?.name || d.network || "—"}</td>
        <td className="px-4 py-3 text-sm text-[var(--muted)]">{EVENT_CATALOG.find((e) => e.key === d.event)?.label || d.event || "—"}</td>
        <td className="px-4 py-3">
          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${tone}`}>{label}</span>
        </td>
        <td className="px-4 py-3 text-sm font-mono text-[var(--muted)] max-w-[160px] truncate">{d.clickId || "—"}</td>
        <td className="px-4 py-3 text-sm">
          {d.payout === null || d.payout === undefined ? "—" : `${d.payout} ${d.payoutCurrency || ""}`}
        </td>
        <td className="px-4 py-3 text-sm text-[var(--muted)]">{d.httpStatus ?? "—"}</td>
        <td className="px-4 py-3 text-xs text-[var(--muted)] whitespace-nowrap">{SOURCE_LABEL[d.source || ""] || d.source || "—"}</td>
        <td className="px-4 py-3 text-sm text-[var(--muted)]">{open ? "▲" : "▼"}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} className="px-4 pb-5 pt-1 bg-[var(--background)]/40">
            {d.status === "skipped" && d.skipReason && (
              <p className="text-xs mb-3 text-[var(--warning)]">
                Not sent — {SKIP_REASON[d.skipReason] || d.skipReason}
              </p>
            )}
            {d.error && <p className="text-xs mb-3 text-[var(--danger)]">Error — {d.error}</p>}
            {!!d.unknownMacros?.length && (
              <p className="text-xs mb-3 text-[var(--warning)]">
                Unrecognised macros left unsubstituted: {d.unknownMacros.map((m) => `{{${m}}}`).join(", ")} — fix
                the template in the Networks tab, or they will reach the network literally.
              </p>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <Field label="Conversion id">{d.conversionId || "—"}</Field>
              <Field label="Transaction">{d.txnid || "—"}</Field>
              <Field label="Goal sent">{d.goal || "—"}</Field>
              <Field label="Order value">
                {d.revenue === null || d.revenue === undefined ? "—" : `${d.revenue} ${d.revenueCurrency || ""}`}
              </Field>
              <Field label="Zone / site">{d.zone || "—"}</Field>
              <Field label="Campaign">{d.campaign || "—"}</Field>
              <Field label="Creative">{d.creative || "—"}</Field>
              <Field label="Country">{d.country || "—"}</Field>
              <Field label="Attempt">
                {d.attempt ?? 1}
                {d.tries ? ` (${d.tries} immediate ${d.tries === 1 ? "try" : "tries"})` : ""}
              </Field>
              <Field label="Duration">{d.durationMs ? `${d.durationMs} ms` : "—"}</Field>
              <Field label="Sent at">{fmtTime(d.sentAt)}</Field>
              <Field label="Auto-retry due">{d.retryPending ? fmtTime(d.nextRetryAt) : "—"}</Field>
            </div>

            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] mb-1">
              {d.method || "GET"} request sent (API key redacted)
            </p>
            <code className="block text-[11px] bg-[var(--background)] border border-[var(--border)] rounded px-2 py-1.5 overflow-x-auto break-all">
              {d.url || "— not rendered —"}
            </code>
            {d.requestBody && (
              <>
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] mt-3 mb-1">Request body</p>
                <code className="block text-[11px] bg-[var(--background)] border border-[var(--border)] rounded px-2 py-1.5 overflow-x-auto break-all">
                  {d.requestBody}
                </code>
              </>
            )}
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] mt-3 mb-1">
              Response from the network
            </p>
            <code className="block text-[11px] bg-[var(--background)] border border-[var(--border)] rounded px-2 py-1.5 overflow-x-auto break-all whitespace-pre-wrap">
              {d.responseSnippet ||
                (d.status === "queued" || d.status === "sending" ? "waiting…" : "— empty —")}
            </code>

            <div className="flex gap-2 mt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard?.writeText(d.url || "");
                }}
              >
                Copy URL
              </Button>
              {/* A retry always sends for real, so the label has to say what it
                  will actually do — "again" is a lie on a preview row — and a
                  row that already succeeded gets a confirm, because re-sending
                  it may register a second conversion at the network. */}
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  if (
                    d.status === "sent" &&
                    !window.confirm(
                      `Re-send this conversion? ${net?.name || "The network"} may count it a second time.`,
                    )
                  )
                    return;
                  onRetry(d.id);
                }}
              >
                {d.dryRun ? "Send for real" : d.status === "sent" ? "Re-send" : "Try again"}
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function DeliveriesPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [fNetwork, setFNetwork] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fEvent, setFEvent] = useState("");
  const [search, setSearch] = useState("");

  // Network and status are pushed into the QUERY, not filtered in memory: the
  // listener only ever holds the newest PAGE_SIZE rows, so filtering client-side
  // would make "no rows for PopCash" mean "none in the last 200 overall" — the
  // exact wrong conclusion when you are debugging a quiet network. Event and the
  // text search stay client-side; they have no index and narrow an already
  // narrowed set. (Firestore allows one of these equality filters alongside the
  // createdAt sort; the composite indexes for both exist.)
  useEffect(() => {
    const cons: QueryConstraint[] = [];
    if (fNetwork) cons.push(where("network", "==", fNetwork));
    else if (fStatus) cons.push(where("status", "==", fStatus));
    const q = query(collection(db(), "adPostbacks"), ...cons, orderBy("createdAt", "desc"), limit(PAGE_SIZE));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Delivery, "id">) })));
        setLoading(false);
      },
      (e) => {
        console.error("deliveries:", e);
        setErr(
          "Could not read deliveries. Only admins can — and a filtered view needs its Firestore index deployed.",
        );
        setLoading(false);
      },
    );
    return () => unsub();
  }, [fNetwork, fStatus]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (fNetwork && r.network !== fNetwork) return false;
      if (fStatus && (r.status || "") !== fStatus) return false;
      if (fEvent && r.event !== fEvent) return false;
      if (s) {
        const hay = `${r.clickId || ""} ${r.txnid || ""} ${r.conversionId || ""} ${r.id}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, fNetwork, fStatus, fEvent, search]);

  const counts = useMemo(() => {
    const c = { sent: 0, failed: 0, queued: 0, sending: 0, skipped: 0 };
    for (const r of rows) {
      const k = (r.status || "skipped") as keyof typeof c;
      if (k in c) c[k]++;
    }
    return c;
  }, [rows]);

  async function retry(id: string) {
    try {
      const u = auth().currentUser;
      if (!u) return toast.error("Sign in again.");
      const token = await u.getIdToken();
      const res = await fetch("/api/admin/postbacks/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Retry failed");
      toast.success("Queued again — the new row appears at the top.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    }
  }

  const selectCls =
    "bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)]";

  return (
    <AdNetworksShell>
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted)]">
          The most recent {PAGE_SIZE} postbacks matching the filters, live. Rows carry a 60-day expiry — enable the
          Firestore TTL policy on <code>expiresAt</code> to have them deleted. Click any row for the exact URL we sent
          and the network&apos;s reply.
        </p>

        <div className="flex flex-wrap gap-3 items-center text-xs">
          <span className="text-[var(--success)]">{counts.sent} sent</span>
          <span className="text-[var(--danger)]">{counts.failed} failed</span>
          <span className="text-[var(--warning)]">{counts.queued + counts.sending} in flight</span>
          <span className="text-[var(--muted)]">{counts.skipped} not sent</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <select value={fNetwork} onChange={(e) => setFNetwork(e.target.value)} className={selectCls}>
            <option value="">All networks</option>
            {AD_NETWORKS.map((n) => (
              <option key={n.slug} value={n.slug}>
                {n.name}
              </option>
            ))}
          </select>
          <select value={fEvent} onChange={(e) => setFEvent(e.target.value)} className={selectCls}>
            <option value="">All events</option>
            {EVENT_CATALOG.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectCls}>
            <option value="">Any status</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="queued">Queued</option>
            <option value="sending">Sending</option>
            <option value="skipped">Not sent</option>
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Click id, txn id…"
            className={`${selectCls} flex-1 min-w-[180px]`}
          />
        </div>

        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}

        {loading ? (
          <div className="py-10 flex justify-center">
            <Loader />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
            <p className="text-sm text-[var(--muted)]">
              {rows.length === 0
                ? fNetwork || fStatus
                  ? "Nothing matches this filter. Because the network and status filters run as queries, this really does mean there are no such rows."
                  : "No postbacks yet. Send a test from the Networks tab to prove the pipeline end to end."
                : `Nothing in the newest ${PAGE_SIZE} rows matches the event or search filter — narrow by network first if you are looking further back.`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <table className="w-full">
              <thead className="bg-[var(--background)]/40">
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Network</th>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Click id</th>
                  <th className="px-4 py-3 font-medium">Payout</th>
                  <th className="px-4 py-3 font-medium">HTTP</th>
                  <th className="px-4 py-3 font-medium">Raised by</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((d) => (
                  <Row key={d.id} d={d} onRetry={retry} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdNetworksShell>
  );
}
