import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/track/pixel-event
 *
 * Records that a BROWSER Meta Pixel event fired, so the Pixels panel can show
 * what is actually going through a pixel without anyone installing the Meta
 * Pixel Helper or reading a network tab.
 *
 * This is diagnostics only. It never talks to Meta — `fbq` has already sent the
 * real event straight from the browser by the time this is called, and nothing
 * here can affect whether that succeeded. Losing one of these beacons costs a
 * line in a debug feed and nothing else.
 *
 * It is gated on VERIFY MODE, checked server-side: the pixel's
 * `verifyUntil` must be in the future. That matters for cost — PageView fires
 * on every route change for every visitor, and logging that unconditionally
 * would be a Firestore write per navigation for the life of the site. Verify
 * mode is a short window you open from the panel when you add a pixel, and the
 * check lives here rather than in the client so a stale browser tab (or a
 * hand-rolled POST) cannot keep writing after it closes.
 */

/** Browser events are high-volume diagnostics; they do not need long retention. */
const VERIFY_LOG_TTL_DAYS = 7;
const MAX_STR = 256;
/** Generous enough for a real funnel, low enough to bound a hostile client. */
const PER_IP_LIMIT = 120;
const PER_IP_WINDOW_MS = 10 * 60 * 1000;

/** Events the consumer site is allowed to report — mirrors lib/pixel.ts. */
const ALLOWED_EVENTS = new Set([
  "PageView",
  "ViewContent",
  "Search",
  "InitiateCheckout",
  "CompleteRegistration",
  "Purchase",
]);

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_STR) : null;

function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
    if (parts.length === 1) return parts[0];
  }
  return request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: NextRequest) {
  try {
    const { success: allowed } = rateLimit(
      `pixel-event:${clientIp(request)}`,
      PER_IP_LIMIT,
      PER_IP_WINDOW_MS
    );
    if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const event = str(body.event);
    const slug = (str(body.slug) || "").toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!event || !ALLOWED_EVENTS.has(event) || !slug) {
      return NextResponse.json({ error: "event and slug are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const pixSnap = await db.collection("pixels").doc(slug).get();
    if (!pixSnap.exists) return NextResponse.json({ error: "Unknown pixel" }, { status: 404 });
    const pixel = pixSnap.data() as Record<string, unknown>;

    const until = pixel.verifyUntil as { toDate?: () => Date } | undefined;
    const verifying = !!until?.toDate && until.toDate().getTime() > Date.now();
    // Not an error: the browser is allowed to call this whenever, we just do
    // not store it. 202 keeps the client's "best effort" contract honest.
    if (!verifying) return NextResponse.json({ logged: false }, { status: 202 });

    const now = new Date();
    await db.collection("pixelEvents").add({
      pixelSlug: slug,
      pixelId: str(pixel.pixelId),
      event,
      source: "browser",
      // Echoed back from the browser so a mismatch between the id the page
      // initialised and the id configured is visible in the feed itself.
      reportedPixelId: str(body.pixelId),
      path: str(body.path),
      eventId: str(body.eventId),
      // A small, bounded summary — never the raw params object, which a client
      // controls and could use to write arbitrary documents.
      paramKeys: Array.isArray(body.paramKeys)
        ? body.paramKeys.filter((k): k is string => typeof k === "string").slice(0, 12).map((k) => k.slice(0, 40))
        : [],
      value: typeof body.value === "number" && isFinite(body.value) ? body.value : null,
      userAgent: (request.headers.get("user-agent") || "").slice(0, MAX_STR) || null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + VERIFY_LOG_TTL_DAYS * 24 * 60 * 60 * 1000),
    });

    return NextResponse.json({ logged: true });
  } catch {
    // Diagnostics must never surface as an error on the consumer site.
    return NextResponse.json({ logged: false }, { status: 202 });
  }
}
