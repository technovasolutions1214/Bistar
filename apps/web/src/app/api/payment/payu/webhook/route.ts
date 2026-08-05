import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";

/**
 * PayU Webhook endpoint.
 *
 * PayU POSTs the payment result to CineShortz's S2S router
 * (cineshortz.com/api/payment/payu/router), which forwards it here by matching
 * `productinfo` against the Bistar route in the CineShortz admin. The request
 * body can be either form-urlencoded (standard PayU) or JSON depending on the
 * forwarding layer. Note the router delivers each result TWICE, ~1s apart, so
 * this handler must be safe against concurrent duplicate delivery.
 *
 * Verification:
 *   PayU's reverse hash formula is:
 *     sha512(salt|status|||||||||||email|firstname|productinfo|amount|txnid|key)
 *   We recompute this hash with our stored salt and compare it to the `hash`
 *   field PayU sends. If they match, the payload is authentic.
 *
 * On success we activate the user's subscription for the duration of the plan.
 *
 * EVERY delivery is recorded to `webhookLogs` — including ones rejected before
 * we ever reach the transaction. `transactions.payuRawPayload` only captures the
 * body once the txn is found, so a hash mismatch or an unknown txnid used to
 * leave no trace at all, which is precisely when you most need the payload.
 */

/** Keep a stray/hostile POST from writing an unbounded document. */
const MAX_LOGGED_FIELDS = 60;
const MAX_LOGGED_VALUE_LEN = 512;
/** Matches the CineShortz router's own retention. */
const LOG_TTL_DAYS = 7;

type DeliveryLog = {
  receivedAt: Date;
  contentType: string;
  bodyKeys: string[];
  rawBody: Record<string, string>;
  txnid?: string;
  payuStatus?: string;
  hashMatch?: boolean;
  receivedHash?: string;
  expectedHash?: string;
  outcome?: string;
  responseStatus?: number;
  expiresAt: Date;
};

/**
 * Persist the delivery. Never throws — a logging failure must not be able to
 * stop a subscription from activating.
 */
async function recordDelivery(log: DeliveryLog): Promise<void> {
  try {
    await getAdminDb().collection("webhookLogs").add(log);
  } catch (err) {
    console.error("Failed to write webhookLogs entry:", err);
  }
}

/** Truncate/limit the payload so the log doc stays small and predictable. */
function boundBody(body: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body).slice(0, MAX_LOGGED_FIELDS)) {
    out[k] = typeof v === "string" && v.length > MAX_LOGGED_VALUE_LEN
      ? `${v.slice(0, MAX_LOGGED_VALUE_LEN)}…[truncated]`
      : v;
  }
  return out;
}

async function parseBody(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json();
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      result[k] = String(v ?? "");
    }
    return result;
  }

  // form-urlencoded (standard PayU POST)
  const text = await request.text();
  const params = new URLSearchParams(text);
  const result: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    result[k] = v;
  }
  return result;
}

type Result = { status: number; body: Record<string, unknown> };

async function handleDelivery(
  body: Record<string, string>,
  log: DeliveryLog
): Promise<Result> {
  const {
    key = "",
    txnid = "",
    amount = "",
    productinfo = "",
    firstname = "",
    email = "",
    status = "",
    hash: receivedHash = "",
  } = body;

  log.txnid = txnid;
  log.payuStatus = status;
  log.receivedHash = receivedHash;

  if (!txnid || !status || !receivedHash) {
    // Log it: a silent 400 here is indistinguishable from "PayU never called
    // us", which is exactly what made the last activation outage invisible.
    console.error("PayU webhook missing required fields", {
      hasTxnid: !!txnid,
      hasStatus: !!status,
      hasHash: !!receivedHash,
      keys: Object.keys(body),
    });
    log.outcome = "missing-required-fields";
    return { status: 400, body: { error: "Missing required fields" } };
  }

  // Fetch PayU salt
  const payuSnap = await getAdminDb().collection("settings").doc("payu").get();
  if (!payuSnap.exists) {
    console.error("PayU webhook received but settings not configured");
    log.outcome = "settings-missing";
    return { status: 500, body: { error: "Not configured" } };
  }
  const payu = payuSnap.data() as { key?: string; salt?: string };
  if (!payu.salt) {
    console.error("PayU salt missing from settings");
    log.outcome = "salt-missing";
    return { status: 500, body: { error: "Not configured" } };
  }

  // Verify hash (PayU reverse format)
  // sha512(salt|status|||||||||||email|firstname|productinfo|amount|txnid|key)
  const hashInput = `${payu.salt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  const expectedHash = crypto.createHash("sha512").update(hashInput).digest("hex");

  // Recorded on every delivery: this is the single most useful field for
  // answering "is the forwarder passing PayU's body through untouched?" — the
  // hash covers status, email, firstname, productinfo, amount, txnid and key,
  // so a match proves those arrived byte-identical.
  log.expectedHash = expectedHash;
  log.hashMatch = expectedHash === receivedHash;

  if (!log.hashMatch) {
    console.error("PayU webhook hash mismatch", { txnid });
    log.outcome = "hash-mismatch";
    return { status: 400, body: { error: "Invalid hash" } };
  }

  const db = getAdminDb();
  const txRef = db.collection("transactions").doc(txnid);

  // Normalize PayU's status to our vocabulary.
  const normalizedStatus =
    status === "success"
      ? "success"
      : status === "failure"
        ? "failed"
        : status;

  // Everything below runs inside a single Firestore transaction.
  //
  // The CineShortz router delivers each result twice, about a second apart.
  // The previous read-then-write sequence let both deliveries observe
  // status:"pending", pass the idempotency check, and each extend the
  // subscription — granting double the duration paid for. Firestore
  // transactions retry on contention, so exactly one delivery activates and
  // the other sees status:"success" and no-ops.
  type Outcome =
    | { kind: "unknown-transaction" }
    | { kind: "plan-not-found"; planId: string }
    | { kind: "already-processed" }
    | { kind: "not-success"; status: string }
    | { kind: "activated" };

  const outcome: Outcome = await db.runTransaction(async (t) => {
    // ---- All reads first (Firestore requires reads before writes) ----
    const txSnap = await t.get(txRef);
    if (!txSnap.exists) return { kind: "unknown-transaction" as const };

    const tx = txSnap.data()!;

    // Idempotency: if already processed as success, no-op.
    if (tx.status === "success") return { kind: "already-processed" as const };

    const userId = tx.userId as string;
    const planId = tx.planId as string;

    if (normalizedStatus !== "success") {
      t.update(txRef, {
        status: normalizedStatus,
        payuStatus: status,
        payuRawPayload: body,
        updatedAt: new Date(),
      });
      return { kind: "not-success" as const, status: normalizedStatus };
    }

    const planSnap = await t.get(db.collection("plans").doc(planId));
    if (!planSnap.exists) {
      // The money WAS taken, so record the payment as successful and keep the
      // raw payload — otherwise support has nothing to work from — but flag
      // why no subscription was granted.
      t.update(txRef, {
        status: normalizedStatus,
        payuStatus: status,
        payuRawPayload: body,
        activationError: "plan-not-found",
        updatedAt: new Date(),
      });
      return { kind: "plan-not-found" as const, planId };
    }
    const plan = planSnap.data()!;
    const durationDays: number = plan.duration ?? 30;

    const userRef = db.collection("users").doc(userId);
    const userSnap = await t.get(userRef);
    const existingSub = userSnap.exists ? userSnap.data()?.subscription : null;

    // If user has an active subscription that ends later than 'now', extend
    // from its endDate.
    const now = new Date();
    let startDate = now;
    if (existingSub?.status === "active" && existingSub?.endDate?.toDate) {
      const currentEnd: Date = existingSub.endDate.toDate();
      if (currentEnd > now) {
        startDate = currentEnd;
      }
    }
    const newEndDate = new Date(
      startDate.getTime() + durationDays * 24 * 60 * 60 * 1000
    );

    // ---- Writes ----
    t.update(txRef, {
      status: normalizedStatus,
      payuStatus: status,
      payuRawPayload: body,
      updatedAt: new Date(),
    });

    t.set(
      userRef,
      {
        subscription: {
          planId,
          planName: plan.name ?? planId,
          status: "active",
          startDate: Timestamp.fromDate(now),
          endDate: Timestamp.fromDate(newEndDate),
          transactionId: txnid,
          gateway: "payu",
        },
        updatedAt: new Date(),
      },
      { merge: true }
    );

    return { kind: "activated" as const };
  });

  log.outcome = outcome.kind;

  switch (outcome.kind) {
    case "unknown-transaction":
      console.warn("PayU webhook for unknown transaction", { txnid });
      return { status: 404, body: { error: "Unknown transaction" } };
    case "plan-not-found":
      console.error("PayU webhook: plan not found", { planId: outcome.planId, txnid });
      return { status: 404, body: { error: "Plan not found" } };
    case "already-processed":
      return { status: 200, body: { success: true, message: "Already processed" } };
    case "not-success":
      return { status: 200, body: { received: true, status: outcome.status } };
    case "activated":
      return { status: 200, body: { success: true } };
  }
}

export async function POST(request: NextRequest) {
  const now = new Date();
  const log: DeliveryLog = {
    receivedAt: now,
    contentType: request.headers.get("content-type") || "",
    bodyKeys: [],
    rawBody: {},
    expiresAt: new Date(now.getTime() + LOG_TTL_DAYS * 24 * 60 * 60 * 1000),
  };

  let result: Result;
  try {
    const body = await parseBody(request);
    log.bodyKeys = Object.keys(body);
    log.rawBody = boundBody(body);
    result = await handleDelivery(body, log);
  } catch (error) {
    console.error("PayU webhook error:", error);
    log.outcome = "exception";
    result = { status: 500, body: { error: "Internal server error" } };
  }

  log.responseStatus = result.status;
  await recordDelivery(log);

  return NextResponse.json(result.body, { status: result.status });
}

// PayU may GET the webhook for status checks on some integrations; reject cleanly.
export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST." },
    { status: 405 }
  );
}
