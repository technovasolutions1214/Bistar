import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/track/ad-event
 *
 * Queues a PRE-PURCHASE ad-network postback (landing / registration /
 * initiate_checkout) for the network the visitor came from. Called by
 * `reportAdEvent()` in the browser, usually via sendBeacon — so it takes no
 * Authorization header and must stay cheap and unauthenticated.
 *
 * It does NOT talk to the ad network. It only appends a queued row to
 * `adPostbacks`, which the `onAdPostbackQueued` Cloud Function picks up, renders
 * against the network's configured template and delivers. That keeps exactly
 * one implementation of postback delivery, retry and logging.
 *
 * Purchase is deliberately NOT accepted here. The money event is raised
 * server-side by the `onPurchaseSendAdPostbacks` trigger from a PayU-confirmed
 * transaction, so a hostile client can never fabricate a paid conversion.
 *
 * Four things keep this endpoint from being abused into junk conversion data:
 *   1. a per-IP rate limit, plus a per-network ceiling that no client-supplied
 *      header can influence,
 *   2. the network AND the event must both be enabled in the admin panel,
 *   3. the queue row id is derived from (network, event, click id), and we
 *      create() it — so a click can raise each event at most once, ever,
 *   4. the conversion value is ignored except on initiate_checkout, and clamped
 *      there, so a caller cannot inflate what a network's optimiser bids on.
 */

const ALLOWED_EVENTS = new Set(["landing", "registration", "initiate_checkout"]);
const MAX_VALUE_LEN = 256;
/** Ceiling for a browser-supplied order value, in INR — above any plan we sell. */
const MAX_EVENT_VALUE_INR = 100_000;
/** Matches the deliveries log retention in the Ad Networks panel. */
const LOG_TTL_DAYS = 60;

/**
 * The client's address as the load balancer observed it.
 *
 * NOT `xff[0]`: Google's front end APPENDS to X-Forwarded-For rather than
 * replacing it, so on App Hosting the first entry is whatever the caller chose
 * to send. Keying a rate limit on that makes it free to bypass — one spoofed
 * header per request and the limiter never fires. The address the LB saw is the
 * second from the right, with the LB's own hop last.
 */
function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
    if (parts.length === 1) return parts[0];
  }
  return request.headers.get("x-real-ip") || "unknown";
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_VALUE_LEN) : null;

export async function POST(request: NextRequest) {
  try {
    const { success: allowed } = rateLimit(`ad-event:${clientIp(request)}`, 30, 10 * 60 * 1000);
    if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const b = body as Record<string, unknown>;

    const event = str(b.event);
    if (!event || !ALLOWED_EVENTS.has(event)) {
      return NextResponse.json({ error: "Unsupported event" }, { status: 400 });
    }
    const network = (str(b.network) || "").toLowerCase().replace(/[^a-z0-9-_]/g, "");
    const clickId = str(b.clickId);
    if (!network || !clickId) {
      return NextResponse.json({ error: "network and clickId are required" }, { status: 400 });
    }

    // A second, coarser ceiling that does not depend on a client-controlled key.
    // Even a caller who rotates X-Forwarded-For cannot push more than this many
    // events per network through one instance.
    const { success: underCap } = rateLimit(`ad-event-net:${network}`, 300, 10 * 60 * 1000);
    if (!underCap) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    // The network and this specific event must both be switched on. Checking
    // here (rather than letting the function skip it) keeps the deliveries log
    // free of rows for networks nobody enabled.
    const db = getAdminDb();
    const netSnap = await db.collection("adNetworks").doc(network).get();
    if (!netSnap.exists) return NextResponse.json({ ok: true, skipped: "unknown-network" });
    const cfg = netSnap.data() as {
      enabled?: boolean;
      events?: Record<string, { enabled?: boolean }>;
    };
    if (!cfg.enabled || !cfg.events?.[event]?.enabled) {
      return NextResponse.json({ ok: true, skipped: "event-disabled" });
    }

    // One row per (network, event, click) — for ever. create() makes the repeat
    // a no-op instead of a duplicate conversion at the network.
    const idHash = createHash("sha256").update(`${network}|${event}|${clickId}`).digest("hex").slice(0, 32);
    const now = new Date();

    // The value ends up in {{payout}} — the number the network's optimiser bids
    // against — and this endpoint is unauthenticated, so it cannot be taken on
    // trust. Only initiate_checkout can legitimately carry one (a landing or a
    // registration has no order value to know), and it is capped well above any
    // plan we sell. The currency label is ours, never the caller's.
    const raw = typeof b.value === "number" && isFinite(b.value) && b.value >= 0 ? b.value : null;
    const value =
      event === "initiate_checkout" && raw !== null ? Math.min(raw, MAX_EVENT_VALUE_INR) : null;

    try {
      await db
        .collection("adPostbacks")
        .doc(`evt_${idHash}`)
        .create({
          network,
          event,
          clickId,
          // Stable across retries, so a network that de-duplicates on the
          // conversion id doesn't count a retry as a second conversion.
          conversionId: `evt_${idHash}`,
          zone: str(b.zone),
          campaign: str(b.campaign),
          creative: str(b.creative),
          cost: str(b.cost),
          txnid: null,
          revenue: value,
          revenueCurrency: value !== null ? "INR" : null,
          country: null,
          source: "event-api",
          status: "queued",
          attempt: 1,
          retryPending: false,
          dryRun: false,
          createdAt: now,
          expiresAt: new Date(now.getTime() + LOG_TTL_DAYS * 24 * 60 * 60 * 1000),
        });
    } catch (err) {
      // ALREADY_EXISTS (code 6) is the expected, healthy outcome for a repeat.
      const code = (err as { code?: number })?.code;
      if (code !== 6) throw err;
      return NextResponse.json({ ok: true, skipped: "duplicate" });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ad-event error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
