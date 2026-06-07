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
    if (pixelData.testEventCode) payload.test_event_code = pixelData.testEventCode;

    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(capiToken)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        events_received?: number;
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
      if (ok) logger.info(`CAPI Purchase sent for ${txnId} -> pixel ${pixelSlug}`);
      else logger.error(`CAPI Purchase rejected for ${txnId}`, body.error);
    } catch (err) {
      logger.error(`CAPI Purchase error for ${txnId}`, err);
      await attrRef.set(
        { ...purchasedBase, pixelSlug, capiStatus: "error", capiSentAt: new Date() },
        { merge: true }
      );
    }
  }
);
