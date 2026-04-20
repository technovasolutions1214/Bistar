import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

/**
 * GET /api/payment/status?txnId=<id>
 *
 * Returns the current status of a transaction so the web client can poll
 * while the PayU popup is open. The PayU server-to-server webhook at
 * /api/payment/payu/webhook updates the transaction doc to success/failed;
 * this endpoint is the read side of the same flow.
 *
 * Auth: caller must be logged in and own the transaction. No admin
 * escalation — this is strictly a lightweight read for the paying user.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    let decoded;
    try {
      decoded = await getAdminAuth().verifyIdToken(match[1]);
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const txnId = request.nextUrl.searchParams.get("txnId");
    if (!txnId) {
      return NextResponse.json({ error: "txnId is required" }, { status: 400 });
    }

    const snap = await getAdminDb().collection("transactions").doc(txnId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const data = snap.data()!;
    if (data.userId !== decoded.uid && decoded.admin !== true) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Normalize to a small set the client can switch on. Anything we don't
    // recognise falls back to "pending" so the poller keeps trying.
    const raw = String(data.status ?? "").toLowerCase();
    const status: "pending" | "success" | "failed" =
      raw === "success" ? "success" : raw === "failed" || raw === "failure" ? "failed" : "pending";

    return NextResponse.json({
      status,
      txnId,
      planId: data.planId ?? null,
      amount: typeof data.amount === "number" ? data.amount : null,
      currency: typeof data.currency === "string" ? data.currency : "INR",
    });
  } catch (err) {
    console.error("Payment status lookup failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
