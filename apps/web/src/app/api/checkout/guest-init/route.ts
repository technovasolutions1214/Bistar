import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/checkout/guest-init
 *
 * Records a "pending claim" linking a guest payment — made while signed in
 * anonymously — to the phone number the guest entered at checkout. After the
 * guest later signs in with that phone via OTP, /api/subscription/reconcile
 * matches on the *verified* phone and grants the subscription.
 *
 * This deliberately sits BESIDE the sealed PayU payment flow: it never touches
 * transaction creation or the webhook. It only writes a server-only
 * `pendingClaims/{txnid}` document (clients can't read/write that collection —
 * there's no Firestore rule for it, so it's admin-SDK only).
 */
export async function POST(request: NextRequest) {
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
    const uid = decoded.uid;

    const { txnid, phone } = await request.json();
    if (!txnid || typeof txnid !== "string") {
      return NextResponse.json({ error: "txnid is required" }, { status: 400 });
    }
    // Full E.164 (with leading +) so it matches the Firebase Auth phoneNumber
    // we read back at reconcile time.
    if (!phone || typeof phone !== "string" || !/^\+[1-9]\d{6,14}$/.test(phone)) {
      return NextResponse.json({ error: "A valid phone number is required" }, { status: 400 });
    }

    const { success: allowed } = rateLimit(`guest-init:${uid}`, 10, 10 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429 }
      );
    }

    // The transaction must exist and belong to the caller (the anon uid that
    // the create route stamped). This stops anyone attaching a phone to a
    // transaction that isn't theirs.
    const txRef = getAdminDb().collection("transactions").doc(txnid);
    const txSnap = await txRef.get();
    if (!txSnap.exists) {
      return NextResponse.json({ error: "Unknown transaction" }, { status: 404 });
    }
    const tx = txSnap.data()!;
    if (tx.userId !== uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await getAdminDb().collection("pendingClaims").doc(txnid).set({
      txnid,
      phone,
      anonUid: uid,
      planId: tx.planId ?? null,
      claimedByUid: null,
      createdAt: new Date(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("guest-init error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
