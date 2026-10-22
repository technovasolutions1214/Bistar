import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireMarketingUid } from "@/lib/require-marketing";

/**
 * POST /api/admin/pixels/test   (marketing staff or admin)
 *
 * Sends a one-off Meta Conversions API event for a pixel so you can prove a
 * newly added pixel works before any ad spend depends on it. This is the
 * server-side half of the pixel; the browser half is verified by the Pixels
 * panel's live event feed (see /api/track/pixel-event on the consumer site).
 *
 * Why this has to be a server route at all: the CAPI access token lives in
 * `pixelSecrets/{slug}`, which is `allow read: if false` — no client, including
 * the admin panel, can read it. So the panel asks the server to send on its
 * behalf and never sees the token.
 *
 * It deliberately posts to the SAME Graph endpoint, with the same payload
 * shape, as the real `onPurchaseSendCapi` trigger. A test that used a different
 * code path would prove nothing about the path a real purchase takes.
 *
 * Two things about test_event_code are worth knowing, because both have bitten
 * us:
 *   1. The code is tied to an OPEN Test Events tab in Events Manager and
 *      rotates. A stale one does not fail — Meta answers 200 and quietly
 *      processes the event as REAL traffic, with the reason buried in a
 *      `messages` array. So we return `messages` verbatim and the panel shows
 *      it as a warning. Never treat a 200 here as "it appeared in Test Events".
 *   2. With no code at all the event is unambiguously real. We allow that (it
 *      is the only way to prove the live path end to end) but the panel asks
 *      for confirmation first.
 */

const GRAPH_VERSION = "v21.0";

/** Standard events worth a one-click test, plus the one we actually optimise on. */
const ALLOWED_EVENTS = new Set([
  "Purchase",
  "InitiateCheckout",
  "CompleteRegistration",
  "ViewContent",
  "Search",
  "PageView",
]);

/** Matches the deliveries-log retention used by the Ad Networks panel. */
const LOG_TTL_DAYS = 60;

export async function POST(request: NextRequest) {
  const uid = await requireMarketingUid(request);
  if (!uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = String(body.slug ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "");
  const event = String(body.event ?? "Purchase");
  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
  if (!ALLOWED_EVENTS.has(event)) {
    return NextResponse.json({ error: `Unsupported event "${event}"` }, { status: 400 });
  }

  // A code sent with the request wins, so you can paste the one Events Manager
  // is showing right now without first saving it onto the pixel.
  const inlineCode =
    typeof body.testEventCode === "string" && body.testEventCode.trim()
      ? body.testEventCode.trim().slice(0, 64)
      : undefined;

  const db = getAdminDb();
  const pixSnap = await db.collection("pixels").doc(slug).get();
  if (!pixSnap.exists) return NextResponse.json({ error: `No pixel "${slug}"` }, { status: 404 });
  const pixel = pixSnap.data() as Record<string, unknown>;
  const pixelId = String(pixel.pixelId ?? "").trim();
  if (!pixelId) return NextResponse.json({ error: "Pixel has no Meta Pixel ID" }, { status: 400 });

  const secSnap = await db.collection("pixelSecrets").doc(slug).get();
  const capiToken = secSnap.exists ? (secSnap.data()?.capiToken as string | undefined) : undefined;
  if (!capiToken) {
    return NextResponse.json(
      { error: "This pixel has no CAPI access token. Add a System User token and save." },
      { status: 400 }
    );
  }

  const testEventCode = inlineCode ?? activeTestEventCode(pixel);

  const eventId = `pixel-test-${slug}-${Date.now().toString(36)}`;
  const value = typeof body.value === "number" && isFinite(body.value) ? body.value : 1;

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: event,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
        // No PII: a test event must never invent a person. Meta accepts an event
        // with only these two fields and reports it with a low match quality,
        // which is the honest signal for a synthetic event.
        user_data: {
          client_user_agent: request.headers.get("user-agent") || "Bistar-Admin-PixelTest/1.0",
          client_ip_address: clientIp(request),
        },
        custom_data: {
          currency: "INR",
          value,
          content_type: "product",
          content_ids: ["pixel-test"],
        },
      },
    ],
  };
  if (testEventCode) payload.test_event_code = testEventCode;

  const now = new Date();
  let result: Record<string, unknown>;
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(capiToken)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      events_received?: number;
      messages?: unknown[];
      fbtrace_id?: string;
    };
    const ok = res.ok && !json.error;
    // Meta reports a stale/mismatched test code here, on an otherwise clean
    // 200. Surfacing it is the whole point of this route.
    const messages = Array.isArray(json.messages) ? json.messages.map(String) : [];
    result = {
      ok,
      http: res.status,
      eventsReceived: json.events_received ?? null,
      messages,
      // True only when Meta did NOT complain about the code. This is the one
      // field the panel should trust before claiming "check Test Events".
      landedInTestEvents:
        ok && !!testEventCode && !messages.some((m) => /test_event_code/i.test(m)),
      error: json.error?.message ?? null,
      fbtraceId: json.fbtrace_id ?? null,
    };
  } catch (err) {
    result = {
      ok: false,
      http: 0,
      eventsReceived: null,
      messages: [],
      landedInTestEvents: false,
      error: err instanceof Error ? err.message : "Request to Meta failed",
      fbtraceId: null,
    };
  }

  // Log it to the same feed the browser events land in, so the panel shows one
  // chronological story of everything that reached this pixel.
  await db
    .collection("pixelEvents")
    .doc(eventId)
    .set({
      pixelSlug: slug,
      pixelId,
      event,
      source: "capi-test",
      testEventCode: testEventCode ?? null,
      eventId,
      byUid: uid,
      result,
      createdAt: now,
      expiresAt: new Date(now.getTime() + LOG_TTL_DAYS * 24 * 60 * 60 * 1000),
    })
    .catch(() => {});

  return NextResponse.json({ ...result, eventId, pixelId, testEventCode: testEventCode ?? null });
}

/**
 * The pixel's saved test code, but only while it is still inside its window.
 *
 * An expired code is treated as absent on purpose: `onPurchaseSendCapi` reads
 * the same two fields, so a code left behind on a pixel would otherwise keep
 * flagging real purchases as test events forever — and test events are excluded
 * from reporting and ad optimisation. Silently losing real conversions is a far
 * worse failure than a test that has to be re-run.
 */
function activeTestEventCode(pixel: Record<string, unknown>): string | undefined {
  const code = String(pixel.testEventCode ?? "").trim();
  if (!code) return undefined;
  const until = pixel.testEventCodeExpiresAt as { toDate?: () => Date } | undefined;
  if (until?.toDate && until.toDate().getTime() < Date.now()) return undefined;
  return code;
}

/** The client address as the load balancer observed it — see the ad-event route
 *  on the consumer site for why this is not simply xff[0]. */
function clientIp(request: NextRequest): string | undefined {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
    if (parts.length === 1) return parts[0];
  }
  return request.headers.get("x-real-ip") || undefined;
}
