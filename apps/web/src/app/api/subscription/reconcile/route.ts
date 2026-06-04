import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

/**
 * POST /api/subscription/reconcile
 *
 * Called right after a user signs in with phone OTP. Finds any guest payments
 * recorded against that VERIFIED phone (pendingClaims) and, for each one whose
 * transaction succeeded, grants/extends the subscription on the now-real
 * account. Idempotent — a claim is stamped `claimedByUid` the first time, so a
 * second sign-in (or two concurrent calls) can't double-grant.
 *
 * Phone-only by design: we match on the Firebase Auth phoneNumber, which is
 * proven by the OTP login, so a self-entered payment phone can't be hijacked.
 * Google users (no phone) simply have nothing to claim.
 *
 * The activate/extend logic below intentionally duplicates the PayU webhook's —
 * we do NOT refactor the sealed payment flow to share a helper.
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

    // Read the verified phone from the Auth record (never trust the client).
    const userRecord = await getAdminAuth().getUser(uid);
    const phone = userRecord.phoneNumber;
    if (!phone) {
      return NextResponse.json({ claimed: 0 });
    }

    const db = getAdminDb();
    // Single-field equality → no composite index required.
    const claimsSnap = await db
      .collection("pendingClaims")
      .where("phone", "==", phone)
      .get();

    let claimed = 0;

    for (const claimDoc of claimsSnap.docs) {
      const txnid = claimDoc.id;
      const txRef = db.collection("transactions").doc(txnid);
      const claimPlanId = claimDoc.get("planId") as string | null;

      const applied = await db.runTransaction(async (t) => {
        // All reads first.
        const claimSnap = await t.get(claimDoc.ref);
        if (!claimSnap.exists || claimSnap.get("claimedByUid")) return false;

        const txSnap = await t.get(txRef);
        if (!txSnap.exists) return false;
        const tx = txSnap.data()!;
        if (tx.status !== "success") return false; // not paid (yet) or failed

        const planId = (claimPlanId ?? tx.planId) as string | undefined;
        if (!planId) return false;

        const planSnap = await t.get(db.collection("plans").doc(planId));
        if (!planSnap.exists) return false;
        const plan = planSnap.data()!;
        const durationDays: number = plan.duration ?? 30;

        const userRef = db.collection("users").doc(uid);
        const userSnap = await t.get(userRef);
        const existingSub = userSnap.exists ? userSnap.data()?.subscription : null;

        const now = new Date();
        let startFrom = now;
        if (existingSub?.status === "active" && existingSub?.endDate?.toDate) {
          const currentEnd: Date = existingSub.endDate.toDate();
          if (currentEnd > now) startFrom = currentEnd;
        }
        const newEndDate = new Date(
          startFrom.getTime() + durationDays * 24 * 60 * 60 * 1000
        );

        // Writes.
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
              gateway: tx.gateway ?? "payu",
            },
            updatedAt: new Date(),
          },
          { merge: true }
        );
        t.update(claimDoc.ref, { claimedByUid: uid, claimedAt: new Date() });

        return true;
      });

      if (applied) claimed++;
    }

    return NextResponse.json({ claimed });
  } catch (err) {
    console.error("reconcile error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
