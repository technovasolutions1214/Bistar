import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";

/**
 * PayU Webhook endpoint.
 *
 * PayU (via flix.cinestry.com) POSTs the payment result here once the user
 * completes (or fails) the transaction. The request body can be either
 * form-urlencoded (standard PayU) or JSON depending on the forwarding layer.
 *
 * Verification:
 *   PayU's reverse hash formula is:
 *     sha512(salt|status|||||||||||email|firstname|productinfo|amount|txnid|key)
 *   We recompute this hash with our stored salt and compare it to the `hash`
 *   field PayU sends. If they match, the payload is authentic.
 *
 * On success we activate the user's subscription for the duration of the plan.
 */
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

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request);

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

    if (!txnid || !status || !receivedHash) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Fetch PayU salt
    const payuSnap = await getAdminDb().collection("settings").doc("payu").get();
    if (!payuSnap.exists) {
      console.error("PayU webhook received but settings not configured");
      return NextResponse.json({ error: "Not configured" }, { status: 500 });
    }
    const payu = payuSnap.data() as { key?: string; salt?: string };
    if (!payu.salt) {
      console.error("PayU salt missing from settings");
      return NextResponse.json({ error: "Not configured" }, { status: 500 });
    }

    // Verify hash (PayU reverse format)
    // sha512(salt|status|||||||||||email|firstname|productinfo|amount|txnid|key)
    const hashInput = `${payu.salt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
    const expectedHash = crypto.createHash("sha512").update(hashInput).digest("hex");

    if (expectedHash !== receivedHash) {
      console.error("PayU webhook hash mismatch", { txnid });
      return NextResponse.json(
        { error: "Invalid hash" },
        { status: 400 }
      );
    }

    // Load the pending transaction
    const txRef = getAdminDb().collection("transactions").doc(txnid);
    const txSnap = await txRef.get();

    if (!txSnap.exists) {
      console.warn("PayU webhook for unknown transaction", { txnid });
      return NextResponse.json(
        { error: "Unknown transaction" },
        { status: 404 }
      );
    }

    const tx = txSnap.data()!;

    // Idempotency: if already processed as success, no-op
    if (tx.status === "success") {
      return NextResponse.json({ success: true, message: "Already processed" });
    }

    const userId = tx.userId as string;
    const planId = tx.planId as string;

    // Update transaction status based on PayU status
    const normalizedStatus =
      status === "success"
        ? "success"
        : status === "failure"
          ? "failed"
          : status;

    await txRef.update({
      status: normalizedStatus,
      payuStatus: status,
      payuRawPayload: body,
      updatedAt: new Date(),
    });

    if (normalizedStatus !== "success") {
      return NextResponse.json({ received: true, status: normalizedStatus });
    }

    // Fetch plan to get duration
    const planSnap = await getAdminDb().collection("plans").doc(planId).get();
    if (!planSnap.exists) {
      console.error("PayU webhook: plan not found", { planId });
      return NextResponse.json(
        { error: "Plan not found" },
        { status: 404 }
      );
    }
    const plan = planSnap.data()!;
    const durationDays: number = plan.duration ?? 30;

    const now = new Date();
    const endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Activate subscription (extend if already active)
    const userRef = getAdminDb().collection("users").doc(userId);
    const userSnap = await userRef.get();
    const existingSub = userSnap.exists ? userSnap.data()?.subscription : null;

    // If user has an active subscription that ends later than 'now', extend from its endDate
    let startDate = now;
    if (
      existingSub?.status === "active" &&
      existingSub?.endDate?.toDate
    ) {
      const currentEnd: Date = existingSub.endDate.toDate();
      if (currentEnd > now) {
        startDate = currentEnd;
      }
    }
    const newEndDate = new Date(
      startDate.getTime() + durationDays * 24 * 60 * 60 * 1000
    );

    await userRef.set(
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PayU webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PayU may GET the webhook for status checks on some integrations; reject cleanly.
export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST." },
    { status: 405 }
  );
}
