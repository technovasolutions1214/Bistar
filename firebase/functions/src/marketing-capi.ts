import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { createHash } from "crypto";

if (!admin.apps.length) {
  admin.initializeApp();
}

const GRAPH_VERSION = "v21.0";

// Meta requires PII (email, phone, country, city) SHA-256 hashed, lowercased
// and trimmed. fbp/fbc/ip/user-agent are sent raw.
function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/** Retention for the Pixels-panel event feed; matches the ad-postbacks log. */
const PIXEL_EVENT_TTL_DAYS = 60;

/**
 * A pixel's saved Test Events code, but only while it is still inside its
 * window. An expired or missing code reads as absent — see the call site.
 */
function activeTestEventCode(pixel: admin.firestore.DocumentData): string | undefined {
  const code = String(pixel.testEventCode ?? "").trim();
  if (!code) return undefined;
  const until = pixel.testEventCodeExpiresAt as admin.firestore.Timestamp | undefined;
  if (until?.toDate && until.toDate().getTime() < Date.now()) return undefined;
  return code;
}

/**
 * Append a server event to `pixelEvents`, the feed the Pixels panel reads.
 *
 * Browser events land in the same collection from the consumer site's
 * /api/track/pixel-event, so the panel can show one chronological story of
 * everything that reached a pixel — which is the whole point of the feed, since
 * a CAPI token that can send events is not necessarily allowed to READ the
 * pixel back from the Graph API.
 *
 * Best effort by design: failing to log a diagnostic must never fail, or retry,
 * the purchase trigger that produced it.
 */
async function logPixelEvent(entry: {
  pixelSlug: string;
  pixelId: string;
  event: string;
  eventId: string;
  testEventCode: string | null;
  result: Record<string, unknown>;
}): Promise<void> {
  try {
    const now = new Date();
    await admin
      .firestore()
      .collection("pixelEvents")
      .doc(`capi-${entry.event}-${entry.eventId}`)
      .set({
        ...entry,
        source: "capi-purchase",
        createdAt: now,
        expiresAt: new Date(now.getTime() + PIXEL_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000),
      });
  } catch (err) {
    logger.warn("pixelEvents log failed", err);
  }
}

/**
 * Sends a server-side Meta Conversions API "Purchase" when a transaction flips
 * to success. Fires to the pixel the visitor came from (from the attribution
 * sidecar), or the default pixel. Shares event_id=txnid with the browser
 * Purchase so Meta deduplicates. Records the result back on the attribution doc
 * for the marketing dashboard. Never touches the sealed PayU webhook.
 */
export const onPurchaseSendCapi = onDocumentUpdated(
  { document: "transactions/{txnId}", region: "asia-south1" },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Only on the pending -> success transition.
    if (after.status !== "success" || before.status === "success") return;

    const txnId = event.params.txnId;
    const db = admin.firestore();
    const attrRef = db.collection("attributions").doc(txnId);

    const attrSnap = await attrRef.get();
    const attr = (attrSnap.exists ? attrSnap.data() : {}) as Record<string, unknown>;
    if (attr.capiStatus === "sent") return; // idempotent

    const value = typeof after.amount === "number" ? after.amount : undefined;
    const currency = (after.currency as string) || "INR";
    // Revenue (value/currency) is used only for the CAPI payload below — it is
    // NOT persisted onto the attribution doc, which marketing staff can read.
    // Revenue stays on the admin-only transaction.
    const purchasedBase = {
      status: "purchased",
      purchasedAt: new Date(),
    };

    // Resolve the pixel: the captured slug, else the default pixel.
    let pixelSlug = (attr.pixelSlug as string | undefined) || undefined;
    let pixelData: admin.firestore.DocumentData | undefined;
    if (pixelSlug) {
      const s = await db.collection("pixels").doc(pixelSlug).get();
      if (s.exists) pixelData = s.data();
    }
    if (!pixelData) {
      const def = await db.collection("pixels").where("isDefault", "==", true).limit(1).get();
      if (!def.empty) {
        pixelSlug = def.docs[0].id;
        pixelData = def.docs[0].data();
      }
    }

    if (!pixelData || !pixelSlug || !pixelData.pixelId) {
      logger.info(`CAPI: no pixel configured for ${txnId} — recording purchase only`);
      await attrRef.set({ ...purchasedBase, capiStatus: "skipped", capiReason: "no-pixel" }, { merge: true });
      return;
    }
    const pixelId = pixelData.pixelId as string;

    const secretSnap = await db.collection("pixelSecrets").doc(pixelSlug).get();
    const capiToken = secretSnap.exists
      ? (secretSnap.data()?.capiToken as string | undefined)
      : undefined;
    if (!capiToken) {
      logger.warn(`CAPI: pixel ${pixelSlug} has no token`);
      await attrRef.set(
        { ...purchasedBase, pixelSlug, capiStatus: "skipped", capiReason: "no-token" },
        { merge: true }
      );
      return;
    }

    // Phone/email for matching: guest phone from pendingClaims, else the user doc.
    let phone: string | undefined;
    let email: string | undefined;
    const pc = await db.collection("pendingClaims").doc(txnId).get();
    if (pc.exists) phone = pc.data()?.phone as string | undefined;
    if (after.userId) {
      const userSnap = await db.collection("users").doc(after.userId as string).get();
      if (userSnap.exists) {
        const u = userSnap.data()!;
        phone = phone || (u.phone as string | undefined);
        email = u.email as string | undefined;
      }
    }

    const userData: Record<string, unknown> = {};
    if (phone) userData.ph = [sha256(phone.replace(/[^0-9]/g, ""))];
    if (email) userData.em = [sha256(email)];
    if (attr.fbp) userData.fbp = attr.fbp;
    if (attr.fbc) userData.fbc = attr.fbc;
    if (attr.ip) userData.client_ip_address = attr.ip;
    if (attr.userAgent) userData.client_user_agent = attr.userAgent;
    if (attr.country) userData.country = [sha256(String(attr.country))];

    const payload: Record<string, unknown> = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: txnId, // dedupe with the browser Purchase
          action_source: "website",
          user_data: userData,
          custom_data: {
            currency,
            value,
            content_ids: after.planId ? [after.planId] : undefined,
            content_type: "product",
          },
        },
      ],
    };
    // A test code set in the Pixels panel applies to real purchases too — that
    // is the point, it is how you verify the live path against Events Manager.
    // But it is honoured only inside its window: a code left behind on a pixel
    // would otherwise keep flagging every real purchase as a test event, and
    // test events are excluded from reporting and ad optimisation. Silently
    // losing real conversions is far worse than a test that must be re-run.
    const testCode = activeTestEventCode(pixelData);
    if (testCode) payload.test_event_code = testCode;

    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(capiToken)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        events_received?: number;
        messages?: unknown[];
        fbtrace_id?: string;
      };
      const ok = res.ok && !body.error;
      await attrRef.set(
        {
          ...purchasedBase,
          pixelSlug,
          capiStatus: ok ? "sent" : "error",
          capiResponse: ok
            ? { events_received: body.events_received ?? null, fbtrace_id: body.fbtrace_id ?? null }
            : { error: body.error ?? null, http: res.status },
          capiSentAt: new Date(),
        },
        { merge: true }
      );
      await logPixelEvent({
        pixelSlug,
        pixelId,
        event: "Purchase",
        eventId: txnId,
        testEventCode: testCode ?? null,
        result: {
          ok,
          http: res.status,
          eventsReceived: body.events_received ?? null,
          // Meta reports a stale test_event_code here, on an otherwise clean
          // 200. Without this the panel would show a healthy send for an event
          // that never reached Test Events.
          messages: Array.isArray(body.messages) ? body.messages.map(String) : [],
          error: body.error ? JSON.stringify(body.error).slice(0, 500) : null,
          fbtraceId: body.fbtrace_id ?? null,
        },
      });
      if (ok) logger.info(`CAPI Purchase sent for ${txnId} -> pixel ${pixelSlug}`);
      else logger.error(`CAPI Purchase rejected for ${txnId}`, body.error);
    } catch (err) {
      logger.error(`CAPI Purchase error for ${txnId}`, err);
      await attrRef.set(
        { ...purchasedBase, pixelSlug, capiStatus: "error", capiSentAt: new Date() },
        { merge: true }
      );
      await logPixelEvent({
        pixelSlug,
        pixelId,
        event: "Purchase",
        eventId: txnId,
        testEventCode: testCode ?? null,
        result: {
          ok: false,
          http: 0,
          eventsReceived: null,
          messages: [],
          error: err instanceof Error ? err.message : "request failed",
          fbtraceId: null,
        },
      });
    }
  }
);
