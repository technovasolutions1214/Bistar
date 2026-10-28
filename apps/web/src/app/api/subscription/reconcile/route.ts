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

        // Paid by this very account: the webhook already granted it here.
        // Release the claim without granting the days a second time.
        if (tx.userId === uid && !tx.activationError) {
          t.update(claimDoc.ref, { claimedByUid: uid, claimedAt: new Date() });
          return true;
        }

        const planId = (claimPlanId ?? tx.planId) as string | undefined;
        if (!planId) return false;

        // The window this payment bought, recorded by the webhook.
        const grantedFrom: Date | undefined = tx.grantedFrom?.toDate?.();
        const grantedUntil: Date | undefined = tx.grantedUntil?.toDate?.();

        const planSnap = await t.get(db.collection("plans").doc(planId));
        // Only a purchase without a recorded window needs the plan's length.
        if (!planSnap.exists && !grantedUntil) return false;
        const plan = planSnap.exists ? planSnap.data()! : {};
        const durationDays: number = plan.duration ?? 30;

        const userRef = db.collection("users").doc(uid);
        const userSnap = await t.get(userRef);
        const existingSub = userSnap.exists ? userSnap.data()?.subscription : null;

        // The guest session the purchase was granted to. If support cancelled
        // it there (a refund), there is nothing to move.
        const payerSnap = await t.get(db.collection("users").doc(tx.userId as string));
        const payerSub = payerSnap.exists ? payerSnap.data()?.subscription : null;
        if (payerSub?.transactionId === txnid && payerSub?.status === "cancelled") {
          t.update(claimDoc.ref, { claimedByUid: uid, claimedAt: new Date() });
          return false;
        }

        // A guest has been watching on this purchase from the device they paid
        // on since the moment it was granted — that session stays subscribed.
        // So the account gets what is LEFT of the window it bought, not a fresh
        // period from now; otherwise one payment would buy its days twice.
        // Purchases from before the webhook recorded a window were sold under
        // the old flow, which promised the full length from the claim — they
        // keep that.
        const now = new Date();
        const durationMs = durationDays * 24 * 60 * 60 * 1000;
        let grantMs = durationMs;
        if (grantedUntil instanceof Date) {
          const from = grantedFrom instanceof Date ? grantedFrom.getTime() : grantedUntil.getTime() - durationMs;
          grantMs = Math.max(0, grantedUntil.getTime() - Math.max(now.getTime(), from));
        }
        if (grantMs === 0) {
          // All used up on the paying device: nothing left to move.
          t.update(claimDoc.ref, { claimedByUid: uid, claimedAt: now });
          return false;
        }

        let startFrom = now;
        if (existingSub?.status === "active" && existingSub?.endDate?.toDate) {
          const currentEnd: Date = existingSub.endDate.toDate();
          if (currentEnd > now) startFrom = currentEnd;
        }
        const newEndDate = new Date(startFrom.getTime() + grantMs);

        // Writes.
        t.set(
          userRef,
          {
            subscription: {
              planId,
              planName: plan.name ?? tx.planName ?? planId,
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
