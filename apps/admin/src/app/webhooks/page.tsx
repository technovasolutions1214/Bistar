"use client";
import React, { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Loader } from "@bistar/ui";

/**
 * PayU webhook delivery log.
 *
 * Shows the EXACT body the CineShortz router forwards to
 * /api/payment/payu/webhook, for every delivery — including ones rejected
 * before they reach the transaction (bad hash, unknown txnid), which leave no
 * trace anywhere else. Use this to confirm a real payment end-to-end.
 */

interface WebhookLog {
  id: string;
  receivedAt?: { toDate?: () => Date };
  contentType?: string;
  bodyKeys?: string[];
  rawBody?: Record<string, string>;
  txnid?: string;
  payuStatus?: string;
  hashMatch?: boolean;
  receivedHash?: string;
  expectedHash?: string;
  outcome?: string;
  responseStatus?: number;
}

// What each outcome means for the buyer — the router's own log only shows an
// HTTP code, and three different outcomes all return 200.
const OUTCOME_LABEL: Record<string, { text: string; tone: "good" | "warn" | "bad" }> = {
  activated: { text: "Subscription activated", tone: "good" },
  "already-processed": { text: "Duplicate delivery (ignored)", tone: "good" },
  "not-success": { text: "PayU reported failure", tone: "warn" },
  "unknown-transaction": { text: "No such transaction", tone: "bad" },
  "plan-not-found": { text: "Paid, but plan missing", tone: "bad" },
  "hash-mismatch": { text: "Hash mismatch — payload altered or wrong salt", tone: "bad" },
  "missing-required-fields": { text: "Missing txnid/status/hash", tone: "bad" },
  "settings-missing": { text: "PayU settings not configured", tone: "bad" },
  "salt-missing": { text: "PayU salt not configured", tone: "bad" },
  exception: { text: "Handler threw", tone: "bad" },
};

const TONE_CLASS: Record<string, string> = {
  good: "bg-[var(--success)]/15 text-[var(--success)]",
  warn: "bg-[var(--warning)]/15 text-[var(--warning)]",
  bad: "bg-[var(--danger)]/15 text-[var(--danger)]",
};

function Row({ log }: { log: WebhookLog }) {
  const [open, setOpen] = useState(false);
  const when = log.receivedAt?.toDate?.();
  const meta = (log.outcome && OUTCOME_LABEL[log.outcome]) || {
    text: log.outcome || "unknown",
    tone: "bad" as const,
  };
  const body = log.rawBody || {};
  const keys = Object.keys(body).sort();

  return (
    <>
      <tr
        className="hover:bg-[var(--card-hover)] transition-colors cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-4 py-3 text-sm text-[var(--muted)] whitespace-nowrap">
          {when
            ? when.toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : "—"}
        </td>
        <td className="px-4 py-3 text-sm font-mono text-[var(--muted)]">{log.txnid || "—"}</td>
        <td className="px-4 py-3 text-sm">{log.payuStatus || "—"}</td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
              log.hashMatch
                ? "bg-[var(--success)]/15 text-[var(--success)]"
                : "bg-[var(--danger)]/15 text-[var(--danger)]"
            }`}
          >
            {log.hashMatch === undefined ? "n/a" : log.hashMatch ? "valid" : "MISMATCH"}
          </span>
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${TONE_CLASS[meta.tone]}`}
          >
            {meta.text}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-[var(--muted)]">{log.responseStatus ?? "—"}</td>
        <td className="px-4 py-3 text-sm text-[var(--muted)]">{open ? "▲" : "▼"}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="px-4 pb-5 pt-1 bg-[var(--background)]/40">
            <p className="text-xs text-[var(--muted)] mb-2">
              Exact body received from the CineShortz router · content-type{" "}
              <code className="text-[var(--primary)]">{log.contentType || "—"}</code> ·{" "}
              {keys.length} fields
            </p>
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-[var(--border)]">
                  {keys.map((k) => (
                    <tr key={k}>
                      <td className="px-3 py-1.5 font-mono text-[var(--muted)] w-56 align-top">
                        {k}
                      </td>
                      <td className="px-3 py-1.5 font-mono break-all">{body[k] || "—"}</td>
                    </tr>
                  ))}
                  {keys.length === 0 && (
                    <tr>
                      <td className="px-3 py-2 text-[var(--muted)]">Empty body.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {log.hashMatch === false && (
              <div className="mt-3 text-xs">
                <p className="text-[var(--danger)] mb-1">
                  Hash mismatch — the forwarded body does not match what our salt produces.
                </p>
                <p className="font-mono break-all text-[var(--muted)]">
                  received: {log.receivedHash || "—"}
                </p>
                <p className="font-mono break-all text-[var(--muted)]">
                  expected: {log.expectedHash || "—"}
                </p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function WebhooksPage() {
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = query(
      collection(db(), "webhookLogs"),
      orderBy("receivedAt", "desc"),
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WebhookLog));
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load webhook logs:", err);
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const activated = useMemo(
    () => logs.filter((l) => l.outcome === "activated").length,
    [logs],
  );
  const rejected = useMemo(
    () => logs.filter((l) => (l.responseStatus ?? 200) >= 400).length,
    [logs],
  );

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">PayU Webhook Deliveries</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Live. Every S2S delivery the CineShortz router forwards to{" "}
          <code className="text-[var(--primary)]">/api/payment/payu/webhook</code>, with the exact
          body received. Click a row to expand. Entries auto-expire after 7 days.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded-lg text-sm text-[var(--danger)]">
          Couldn&apos;t load logs: {error}
        </div>
      )}

      {loading ? (
        <Loader />
      ) : logs.length === 0 ? (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-10 text-center">
          <p className="text-sm text-[var(--muted)]">
            No deliveries recorded yet. Make a test payment — every attempt will appear here within
            seconds, including ones rejected for a bad hash.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-3 mb-4 text-sm">
            <span className="px-3 py-1.5 rounded-lg bg-[var(--card)] border border-[var(--border)]">
              {logs.length} shown
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-[var(--success)]/10 text-[var(--success)]">
              {activated} activated
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-[var(--danger)]/10 text-[var(--danger)]">
              {rejected} rejected
            </span>
          </div>

          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="text-left text-xs text-[var(--muted)] uppercase tracking-wider border-b border-[var(--border)]">
                    <th className="px-4 py-3 font-medium">Received (IST)</th>
                    <th className="px-4 py-3 font-medium">Txn ID</th>
                    <th className="px-4 py-3 font-medium">PayU status</th>
                    <th className="px-4 py-3 font-medium">Hash</th>
                    <th className="px-4 py-3 font-medium">Outcome</th>
                    <th className="px-4 py-3 font-medium">HTTP</th>
                    <th className="px-4 py-3 font-medium">Body</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {logs.map((log) => (
                    <Row key={log.id} log={log} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AdminLayout>
  );
}
