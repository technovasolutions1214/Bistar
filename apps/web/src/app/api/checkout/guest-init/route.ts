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
 *
 * The link is made once, before payment, and is then fixed. It used to be a
 * plain overwrite with no check on the transaction's status: the owner of a
 * PAID transaction could re-link it to another number — resetting
 * claimedByUid — and have reconcile grant the same payment again, as often as
 * they liked. So: anonymous sessions only (a real account pays on itself),
 * the transaction must still be pending, and a claim that has been released
 * is never touched.
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

    // Guest checkout only. The token alone can't say so for sure (a session
    // keeps its sign-in method in its tokens), so check the Auth record too.
    const authUser = await getAdminAuth().getUser(uid);
    if (decoded.firebase.sign_in_provider !== "anonymous" || authUser.providerData.length > 0) {
      return NextResponse.json({ error: "Guest checkout only" }, { status: 403 });
    }

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

    const db = getAdminDb();
    const txRef = db.collection("transactions").doc(txnid);
    const claimRef = db.collection("pendingClaims").doc(txnid);

    const refusal = await db.runTransaction(async (t) => {
      const [txSnap, claimSnap] = await Promise.all([t.get(txRef), t.get(claimRef)]);
      // The transaction must exist and belong to the caller (the anon uid that
      // the create route stamped). This stops anyone attaching a phone to a
      // transaction that isn't theirs.
      if (!txSnap.exists) return { status: 404, error: "Unknown transaction" };
      const tx = txSnap.data()!;
      if (tx.userId !== uid) return { status: 403, error: "Forbidden" };
      // Before payment only: once PayU has answered, the number is settled.
      if (tx.status !== "pending" || claimSnap.get("claimedByUid")) {
        return { status: 409, error: "This payment has already been processed" };
      }

      t.set(claimRef, {
        txnid,
        phone,
        anonUid: uid,
        planId: tx.planId ?? null,
        claimedByUid: null,
        createdAt: new Date(),
      });
      return null;
    });
    if (refusal) {
      return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("guest-init error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
