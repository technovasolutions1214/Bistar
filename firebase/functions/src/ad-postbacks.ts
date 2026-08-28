import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

// ---------------------------------------------------------------------------
// Ad-network S2S (server-to-server) postbacks.
//
// We buy traffic from PropellerAds / RichAds / EvaDav / AdMaven / PopAds /
// PopCash / HilltopAds. Each of them hands the visitor a CLICK ID which it
// substitutes into our landing URL (?net=<slug>&cid=<their macro>). When that
// visitor converts we must call the network back, server side, echoing that
// click id — that is the only way their optimiser learns which zones/creatives
// produce paying subscribers.
//
// ARCHITECTURE — one queue, one delivery path:
//
//   transactions/{id} -> success ─┐
//   web /api/track/ad-event       ├─> adPostbacks/{id} (status:"queued")
//   admin test / retry            ─┘            │
//                                               ▼
//                                    onAdPostbackQueued
//                         claim (queued→sending) → render → validate
//                                     → HTTP → log
//                                               │
//                                 ┌─────────────┴─────────────┐
//                            status:"sent"              status:"failed"
//                                                    retryPending:true
//                                                            │
//                                                  retryAdPostbacks (30m)
//                                     re-queues with backoff, and rescues rows
//                                     stranded in queued/sending by a crash
//
// Everything about a delivery — the rendered URL, the response, the payout we
// computed — is written back onto the same `adPostbacks` row, which is what the
// admin panel's Deliveries tab reads. Admin-only at the rules layer: the
// marketing role never sees this pipeline.
//
// Config lives in `adNetworks/{slug}` (admin-editable) and any API key in
// `adNetworkSecrets/{slug}` (write-only for admins, read only by this code).
// ---------------------------------------------------------------------------

const REGION = "asia-south1";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 5;
/** Inline tries within a single invocation, for transient failures. */
const INLINE_TRIES = 3;
/** Redirect hops we will follow, re-checking the target at each one. */
const MAX_REDIRECTS = 3;
/** A delivery still "queued"/"sending" after this long was stranded by a
 *  crashed invocation and is re-queued by the sweeper. */
const STRANDED_AFTER_MS = 15 * 60_000;
/** Absolute backstop above whatever maxAttempts a network is configured with,
 *  so no chain of retries can run away. */
const HARD_ATTEMPT_CAP = 12;
const RESPONSE_SNIPPET_LEN = 512;
const LOG_TTL_DAYS = 60;
/** Backoff before each subsequent queued attempt (attempt 2, 3, 4, 5). */
const RETRY_BACKOFF_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

export type AdEventKey = "landing" | "registration" | "initiate_checkout" | "purchase";

interface EventConfig {
  enabled?: boolean;
  /** The network's own goal / conversion-type identifier, if it uses one. */
  goal?: string;
  payoutMode?: PayoutMode;
  payoutFixed?: number;
  payoutPercent?: number;
}

type PayoutMode = "revenue" | "percent" | "fixed" | "none";

interface NetworkConfig {
  enabled?: boolean;
  postbackUrl?: string;
  method?: "GET" | "POST";
  postbackBody?: string;
  postbackContentType?: string;
  extraHeaders?: Record<string, string>;
  successPattern?: string;
  failurePattern?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  payoutMode?: PayoutMode;
  payoutFixed?: number;
  payoutPercent?: number;
  payoutCurrency?: string;
  /** Multiplier applied to revenue before it is sent (e.g. INR->USD). */
  fxRate?: number;
  events?: Record<string, EventConfig>;
}

interface PostbackRow {
  network?: string;
  event?: AdEventKey;
  clickId?: string;
  conversionId?: string;
  zone?: string | null;
  campaign?: string | null;
  creative?: string | null;
  cost?: string | null;
  txnid?: string | null;
  revenue?: number | null;
  revenueCurrency?: string | null;
  country?: string | null;
  source?: string;
  /** Survives re-queueing, unlike `source`, so a retried manual test still
   *  bypasses the enable switches. */
  manualBypass?: boolean;
  status?: string;
  attempt?: number;
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/**
 * Macros the admin can put in a postback URL / body. DOUBLE braces on purpose:
 * several networks' own macros use `${SUBID}` / `{clickid}`, and a single-brace
 * syntax here would eat them. Anything we don't recognise is left untouched and
 * reported back on the delivery row as `unknownMacros`, so a typo shows up in
 * the panel instead of silently sending an empty value.
 */
export const MACROS = [
  "click_id",
  "payout",
  "currency",
  "event",
  "goal",
  "txn_id",
  "conversion_id",
  "zone",
  "campaign",
  "creative",
  "cost",
  "country",
  "network",
  "revenue",
  "revenue_currency",
  "timestamp",
  "api_key",
] as const;

const MACRO_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Drop `&name={{macro}}` pairs whose macro resolves to nothing, so an unset
 * payout sends no `payout=` at all rather than an empty one (several networks
 * reject an empty numeric parameter). Only whole-value macros are dropped —
 * `&x=v{{macro}}` is left alone because we can't know what the network expects.
 */
function dropEmptyMacroParams(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  const pairs = [...tpl.matchAll(/[?&]([^=&#\s]+)=\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)];
  for (const [, param, macro] of pairs) {
    if (vars[macro] !== "") continue; // unknown macros aren't in vars -> undefined, keep
    const p = escapeRe(param);
    const m = escapeRe(macro);
    out = out
      .replace(new RegExp(`&${p}=\\{\\{\\s*${m}\\s*\\}\\}`, "g"), "")
      .replace(new RegExp(`\\?${p}=\\{\\{\\s*${m}\\s*\\}\\}&`, "g"), "?")
      .replace(new RegExp(`\\?${p}=\\{\\{\\s*${m}\\s*\\}\\}(?=$|#)`, "g"), "");
  }
  return out;
}

/**
 * Substitute `{{macro}}` tokens. Values are URL-encoded: every macro we support
 * is destined for a query parameter or an urlencoded body.
 *
 * `dropEmptyParams` runs the pruning above first. For a POST body pass
 * `leadingSeparator: false` — a body's first parameter has no `?` or `&` in
 * front of it, so it is prefixed with one for the scan and stripped again.
 */
export function renderTemplate(
  tpl: string,
  vars: Record<string, string>,
  opts: { dropEmptyParams?: boolean; leadingSeparator?: boolean } = {},
): { text: string; unknown: string[] } {
  const unknown = new Set<string>();
  let base = tpl;
  if (opts.dropEmptyParams) {
    base =
      opts.leadingSeparator === false
        ? dropEmptyMacroParams(`&${tpl}`, vars).replace(/^&/, "")
        : dropEmptyMacroParams(tpl, vars);
  }
  const text = base.replace(MACRO_RE, (whole, name: string) => {
    if (!(name in vars)) {
      unknown.add(name);
      return whole; // leave it visible in the logged URL
    }
    return encodeURIComponent(vars[name]);
  });
  return { text, unknown: [...unknown] };
}

// ---------------------------------------------------------------------------
// Payout
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/**
 * What to put in `{{payout}}`.
 *
 *   revenue  — the order value multiplied by `fxRate` (set 1 to send INR as-is,
 *              or e.g. 0.012 to report a USD figure to a network that expects
 *              USD). Static rate by design: an FX lookup that can fail is not
 *              worth putting in the conversion path.
 *   percent  — `payoutPercent`% of that same converted revenue.
 *   fixed    — a flat number, for networks you optimise against a target CPA.
 *   none     — no payout at all; `{{payout}}` renders empty and, if it is a
 *              whole parameter value, that parameter is dropped.
 *
 * Per-event settings win over the network-level default.
 */
export function computePayout(
  cfg: NetworkConfig,
  ev: EventConfig,
  revenue: number | null,
): { payout: number | null; currency: string } {
  const mode: PayoutMode = ev.payoutMode || cfg.payoutMode || "revenue";
  const fx = num(cfg.fxRate) ?? 1;
  const currency = (cfg.payoutCurrency || "USD").toUpperCase();

  let payout: number | null = null;
  if (mode === "revenue") {
    payout = revenue === null ? null : revenue * fx;
  } else if (mode === "percent") {
    const pct = num(ev.payoutPercent) ?? num(cfg.payoutPercent) ?? 100;
    payout = revenue === null ? null : revenue * fx * (pct / 100);
  } else if (mode === "fixed") {
    payout = num(ev.payoutFixed) ?? num(cfg.payoutFixed);
  }

  if (payout === null || !isFinite(payout) || payout < 0) return { payout: null, currency };
  // Up to 4 decimals, trailing zeros trimmed — networks quoting sub-cent
  // payouts need the precision, and "5.99" reads better than "5.9900".
  return { payout: Number(payout.toFixed(4)), currency };
}

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
]);

/**
 * The postback URL is admin-authored, but it is still a server-side fetch to an
 * arbitrary host — refuse anything that points back inside the deployment.
 * Returns a reason string when the URL must not be called, else null.
 */
export function urlRejectionReason(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "The postback URL is not a valid absolute URL.";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return `Unsupported scheme "${u.protocol}" — use https:// (or http:// if the network requires it).`;
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return `Refusing to call an internal host (${host}).`;
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    return `Refusing to call a private address (${host}).`;
  }
  const m = /^172\.(\d{1,3})\./.exec(host);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) {
    return `Refusing to call a private address (${host}).`;
  }
  if (raw.includes("{{")) {
    return "The rendered URL still contains an unresolved {{macro}}.";
  }
  return null;
}

/** Never let an API key reach the deliveries log. */
function redact(text: string, secret?: string): string {
  if (!secret) return text;
  return text.split(secret).join("***").split(encodeURIComponent(secret)).join("***");
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

interface Attempt {
  httpStatus: number | null;
  body: string;
  error: string | null;
  ok: boolean;
}

/**
 * Redirects are followed BY HAND, re-checking every hop against
 * urlRejectionReason. Letting fetch follow them automatically would hand the
 * destination host a way past the safety check: it only ever sees the URL we
 * wrote, so a 302 to 169.254.169.254 would be fetched unexamined.
 */
async function fireOnce(
  url: string,
  method: "GET" | "POST",
  body: string | null,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Attempt> {
  let current = url;
  for (let hop = 0; ; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(current, {
        method,
        headers,
        body: method === "POST" ? (body ?? "") : undefined,
        signal: controller.signal,
        redirect: "manual",
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) {
          return { httpStatus: res.status, body: "", error: `HTTP ${res.status} with no Location header.`, ok: false };
        }
        if (hop >= MAX_REDIRECTS) {
          return { httpStatus: res.status, body: "", error: `Too many redirects (more than ${MAX_REDIRECTS}).`, ok: false };
        }
        let next: string;
        try {
          next = new URL(loc, current).toString();
        } catch {
          return { httpStatus: res.status, body: "", error: `Unparseable redirect target: ${loc.slice(0, 200)}`, ok: false };
        }
        const reason = urlRejectionReason(next);
        if (reason) {
          return { httpStatus: res.status, body: "", error: `Refused to follow the redirect — ${reason}`, ok: false };
        }
        current = next;
        continue;
      }

      const text = (await res.text().catch(() => "")).slice(0, RESPONSE_SNIPPET_LEN);
      return { httpStatus: res.status, body: text, error: null, ok: res.ok };
    } catch (err) {
      return {
        httpStatus: null,
        body: "",
        error: err instanceof Error ? err.message : String(err),
        ok: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 4xx means the request itself is wrong — repeating it just burns quota. */
function worthRetrying(a: Attempt): boolean {
  if (a.httpStatus === null) return true; // network error / timeout
  if (a.httpStatus === 429) return true;
  return a.httpStatus >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sanitizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(k)) continue;
    if (typeof v !== "string") continue;
    out[k] = v.replace(/[\r\n]/g, "").slice(0, 1024);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The single delivery path: every queued row lands here.
// ---------------------------------------------------------------------------

export const onAdPostbackQueued = onDocumentCreated(
  { document: "adPostbacks/{id}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const row = snap.data() as PostbackRow;

    const ref = snap.ref;
    const db = admin.firestore();
    const finish = (patch: Record<string, unknown>) =>
      ref.set({ ...patch, completedAt: new Date() }, { merge: true });

    // Claim the row before doing anything. `snap.data()` is the payload the
    // document had WHEN CREATED, not a live read, so it always says "queued" —
    // and Firestore triggers are at-least-once. Without this, a redelivered
    // create event fires the same conversion at the network a second time.
    // A claim that is never released (a crashed invocation) is picked back up
    // by retryAdPostbacks, which sweeps stale "sending" rows.
    const claimed = await db.runTransaction(async (tx) => {
      const live = await tx.get(ref);
      if (!live.exists) return false;
      if ((live.data() as PostbackRow).status !== "queued") return false;
      tx.set(ref, { status: "sending", claimedAt: new Date() }, { merge: true });
      return true;
    });
    if (!claimed) {
      logger.info(`ad-postback ${snap.id}: duplicate delivery suppressed`);
      return;
    }

    const network = row.network;
    const evKey = row.event;
    if (!network || !evKey) {
      await finish({ status: "skipped", skipReason: "malformed-row" });
      return;
    }

    const netSnap = await db.collection("adNetworks").doc(network).get();
    if (!netSnap.exists) {
      // Worth surfacing rather than dropping: it means a live ad is sending
      // ?net=<something> that nobody configured, i.e. a typo in a landing URL.
      await finish({ status: "skipped", skipReason: "unknown-network" });
      return;
    }
    const cfg = netSnap.data() as NetworkConfig;
    const evCfg: EventConfig = cfg.events?.[evKey] ?? {};

    // A manual test from the panel deliberately bypasses the enable switches —
    // that is how you verify a network before turning it on.
    const isManual = row.source === "manual-test" || row.manualBypass === true;
    if (!isManual && !cfg.enabled) {
      await finish({ status: "skipped", skipReason: "network-disabled" });
      return;
    }
    if (!isManual && !evCfg.enabled) {
      await finish({ status: "skipped", skipReason: "event-disabled" });
      return;
    }

    const template = (cfg.postbackUrl || "").trim();
    if (!template) {
      await finish({ status: "skipped", skipReason: "no-postback-url" });
      return;
    }

    const secretSnap = await db.collection("adNetworkSecrets").doc(network).get();
    const apiKey = secretSnap.exists
      ? ((secretSnap.data()?.apiKey as string | undefined) || "")
      : "";

    const { payout, currency } = computePayout(cfg, evCfg, row.revenue ?? null);
    const vars: Record<string, string> = {
      click_id: row.clickId || "",
      payout: payout === null ? "" : String(payout),
      // A currency with no amount beside it is noise, and HilltopAds' own
      // micro-conversion example omits both together — so when there is no
      // payout, {{currency}} empties out and its parameter drops with it.
      currency: payout === null ? "" : currency,
      event: evKey,
      goal: evCfg.goal || "",
      txn_id: row.txnid || "",
      conversion_id: row.conversionId || snap.id,
      zone: row.zone || "",
      campaign: row.campaign || "",
      creative: row.creative || "",
      cost: row.cost || "",
      country: row.country || "",
      network,
      revenue: row.revenue === null || row.revenue === undefined ? "" : String(row.revenue),
      revenue_currency: row.revenueCurrency || "",
      timestamp: String(Math.floor(Date.now() / 1000)),
      api_key: apiKey,
    };

    const rendered = renderTemplate(template, vars, { dropEmptyParams: true });
    const url = rendered.text.trim();
    const method: "GET" | "POST" = cfg.method === "POST" ? "POST" : "GET";

    const contentType = (cfg.postbackContentType || "").trim() || "application/x-www-form-urlencoded";
    let body: string | null = null;
    let unknown = rendered.unknown;
    if (method === "POST" && (cfg.postbackBody || "").trim()) {
      // Prune empty parameters out of a form body for the same reason we do it
      // in the query string. A JSON body is left alone — deleting a key out of
      // JSON by regex would produce something that no longer parses.
      const isForm = contentType.toLowerCase().startsWith("application/x-www-form-urlencoded");
      const rb = renderTemplate(cfg.postbackBody!.trim(), vars, {
        dropEmptyParams: isForm,
        leadingSeparator: false,
      });
      body = rb.text;
      unknown = [...new Set([...unknown, ...rb.unknown])];
    }

    const headers: Record<string, string> = {
      "User-Agent": "Bistar-Postback/1.0",
      ...sanitizeHeaders(cfg.extraHeaders),
    };
    if (method === "POST") headers["Content-Type"] = contentType;

    const safeUrl = redact(url, apiKey);
    const safeBody = body === null ? null : redact(body, apiKey);
    const common = {
      url: safeUrl,
      method,
      requestBody: safeBody,
      payout,
      payoutCurrency: currency,
      goal: evCfg.goal || null,
      unknownMacros: unknown,
    };

    // An unresolved macro must never reach a network — in the body either, which
    // urlRejectionReason cannot see.
    const reason =
      urlRejectionReason(url) ||
      (body && body.includes("{{") ? "The rendered POST body still contains an unresolved {{macro}}." : null);
    if (reason) {
      await finish({ ...common, status: "failed", error: reason, retryPending: false });
      logger.error(`ad-postback ${snap.id}: ${reason}`);
      return;
    }

    // Dry run: the panel's "Preview URL" — render and record, send nothing.
    if (row.dryRun) {
      await finish({ ...common, status: "skipped", skipReason: "dry-run" });
      return;
    }

    const timeoutMs = num(cfg.timeoutMs) ?? DEFAULT_TIMEOUT_MS;
    const successPattern = (cfg.successPattern || "").trim().toLowerCase();
    const failurePattern = (cfg.failurePattern || "").trim().toLowerCase();
    const startedAt = Date.now();

    let attempt: Attempt | null = null;
    let tries = 0;
    for (let i = 0; i < INLINE_TRIES; i++) {
      tries = i + 1;
      attempt = await fireOnce(url, method, body, headers, timeoutMs);
      if (attempt.ok || !worthRetrying(attempt)) break;
      if (i < INLINE_TRIES - 1) await sleep(i === 0 ? 1_000 : 4_000);
    }
    const a = attempt!;

    // Several of these endpoints answer 200 whatever you send them — EvaDav
    // returns 200 with {"status":"error",…} for a bad click id, RichAds returns
    // 200 with "Required url parameters are not present". Reading the body is
    // the only way to tell an accepted conversion from a rejected one, so the
    // admin can name either the text that proves success or the text that
    // proves failure.
    const lower = a.body.toLowerCase();
    const patternOk = !successPattern || lower.includes(successPattern);
    const failMatched = !!failurePattern && lower.includes(failurePattern);
    const ok = a.ok && patternOk && !failMatched;
    const bodyVerdict = failMatched
      ? "The response matched this network's failure pattern."
      : a.ok && !patternOk
        ? "The response did not match the success pattern."
        : null;

    const maxAttempts = num(cfg.maxAttempts) ?? DEFAULT_MAX_ATTEMPTS;
    const attemptNo = row.attempt ?? 1;
    const canRetryLater = !ok && worthRetrying(a) && attemptNo < maxAttempts;
    const backoff = RETRY_BACKOFF_MS[Math.min(attemptNo - 1, RETRY_BACKOFF_MS.length - 1)];

    await finish({
      ...common,
      status: ok ? "sent" : "failed",
      httpStatus: a.httpStatus,
      responseSnippet: redact(a.body, apiKey),
      error: a.error || bodyVerdict,
      tries,
      durationMs: Date.now() - startedAt,
      sentAt: new Date(),
      retryPending: canRetryLater,
      nextRetryAt: canRetryLater ? new Date(Date.now() + backoff) : null,
    });

    if (ok) logger.info(`ad-postback sent: ${network}/${evKey} ${snap.id}`);
    else logger.warn(`ad-postback failed: ${network}/${evKey} ${snap.id} http=${a.httpStatus} ${a.error ?? ""}`);
  },
);

// ---------------------------------------------------------------------------
// Source 1 — the money event, raised from a PayU-confirmed transaction.
// ---------------------------------------------------------------------------

export const onPurchaseSendAdPostbacks = onDocumentUpdated(
  { document: "transactions/{txnId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (after.status !== "success" || before.status === "success") return;

    const txnId = event.params.txnId;
    const db = admin.firestore();

    const attrSnap = await db.collection("adAttributions").doc(txnId).get();
    if (!attrSnap.exists) return; // not ad-network traffic
    const attr = attrSnap.data()!;
    const network = attr.network as string | undefined;
    const clickId = attr.clickId as string | undefined;
    if (!network || !clickId) return;

    const now = new Date();
    // Deterministic id: the PayU router delivers each result twice, and this
    // trigger can also be re-run — create() makes both harmless.
    try {
      await db
        .collection("adPostbacks")
        .doc(`pb_${txnId}_${network}`)
        .create({
          network,
          event: "purchase" as AdEventKey,
          clickId,
          conversionId: txnId,
          zone: attr.zone ?? null,
          campaign: attr.campaign ?? null,
          creative: attr.creative ?? null,
          cost: attr.cost ?? null,
          txnid: txnId,
          revenue: typeof after.amount === "number" ? after.amount : null,
          revenueCurrency: (after.currency as string) || "INR",
          country: attr.country ?? null,
          source: "purchase-trigger",
          status: "queued",
          attempt: 1,
          retryPending: false,
          dryRun: false,
          createdAt: now,
          expiresAt: new Date(now.getTime() + LOG_TTL_DAYS * 24 * 60 * 60 * 1000),
        });
    } catch (err) {
      if ((err as { code?: number })?.code === 6) return; // ALREADY_EXISTS
      logger.error(`ad-postback enqueue failed for ${txnId}`, err);
    }
  },
);

// ---------------------------------------------------------------------------
// Retry sweeper — re-queues deliveries that failed for a transient reason, and
// rescues deliveries that were stranded mid-flight.
// ---------------------------------------------------------------------------

/**
 * Queue a fresh attempt carrying `row`'s context. A NEW row is created rather
 * than the old one reset, because only a document CREATE re-triggers the
 * delivery function — and because the failed attempt stays in the log instead
 * of being overwritten. `conversionId` is preserved, so a network that
 * de-duplicates on it counts one conversion no matter how often we try.
 *
 * Returns false when `cap` is reached, which is what stops a permanently broken
 * configuration from re-queueing itself for ever.
 */
async function enqueueRetry(
  db: admin.firestore.Firestore,
  doc: admin.firestore.QueryDocumentSnapshot,
  now: Date,
  cap: number,
): Promise<boolean> {
  const row = doc.data() as PostbackRow;
  const attempt = (row.attempt ?? 1) + 1;
  if (attempt > cap) return false;

  const rootId = doc.id.replace(/__r\d+$/, "");
  try {
    await db
      .collection("adPostbacks")
      .doc(`${rootId}__r${attempt}`)
      .create({
        network: row.network,
        event: row.event,
        clickId: row.clickId,
        conversionId: row.conversionId ?? rootId,
        zone: row.zone ?? null,
        campaign: row.campaign ?? null,
        creative: row.creative ?? null,
        cost: row.cost ?? null,
        txnid: row.txnid ?? null,
        revenue: row.revenue ?? null,
        revenueCurrency: row.revenueCurrency ?? null,
        country: row.country ?? null,
        source: "retry",
        // `source` becomes "retry", so the manual-test bypass has to travel in
        // its own field or a retried test would be skipped as network-disabled.
        manualBypass: row.source === "manual-test" || row.manualBypass === true,
        parentId: doc.id,
        status: "queued",
        attempt,
        retryPending: false,
        dryRun: false,
        createdAt: now,
        expiresAt: new Date(now.getTime() + LOG_TTL_DAYS * 24 * 60 * 60 * 1000),
      });
    return true;
  } catch (err) {
    // ALREADY_EXISTS means a previous sweep already queued this attempt.
    if ((err as { code?: number })?.code === 6) return true;
    logger.error(`ad-postback retry enqueue failed for ${doc.id}`, err);
    return false;
  }
}

export const retryAdPostbacks = onSchedule(
  { schedule: "every 30 minutes", region: REGION },
  async () => {
    const db = admin.firestore();
    const now = new Date();
    const col = db.collection("adPostbacks");

    // 1. Failures whose backoff has elapsed.
    const due = await col
      .where("retryPending", "==", true)
      .where("nextRetryAt", "<=", now)
      .orderBy("nextRetryAt")
      .limit(100)
      .get();

    // The delivery function already checked the network's own maxAttempts
    // before setting retryPending, so here we only enforce the backstop.
    let requeued = 0;
    for (const d of due.docs) {
      if (await enqueueRetry(db, d, now, HARD_ATTEMPT_CAP)) requeued++;
      // Clear the flag either way: the retry now exists (or the cap was hit),
      // so this row must not be picked up again.
      await d.ref.set({ retryPending: false }, { merge: true });
    }

    // 2. Stranded deliveries. A row sits at "queued" if the trigger never ran,
    //    and at "sending" if the invocation died after claiming it — neither
    //    sets retryPending, so without this sweep a real purchase conversion
    //    would be silently lost.
    const cutoff = new Date(now.getTime() - STRANDED_AFTER_MS);
    let rescued = 0;
    for (const [status, field] of [
      ["queued", "createdAt"],
      ["sending", "claimedAt"],
    ] as const) {
      const stale = await col
        .where("status", "==", status)
        .where(field, "<=", cutoff)
        .orderBy(field)
        .limit(50)
        .get();
      for (const d of stale.docs) {
        await d.ref.set(
          {
            status: "failed",
            error: `Delivery was stranded in "${status}" — the function never finished. Re-queued.`,
            retryPending: false,
            completedAt: now,
          },
          { merge: true },
        );
        // Nothing decided an attempt budget for a stranded row, so use the
        // default rather than the backstop.
        if (await enqueueRetry(db, d, now, DEFAULT_MAX_ATTEMPTS)) rescued++;
      }
    }

    if (requeued || rescued) {
      logger.info(`ad-postback sweep: ${requeued} retried, ${rescued} rescued from a stranded state`);
    }
  },
);
