import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface ConfirmPaymentData {
  userId: string;
  planId: string;
  transactionId: string;
}

export const confirmPayment = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { userId, planId, transactionId } = request.data as ConfirmPaymentData;

  if (!userId || !planId || !transactionId) {
    throw new HttpsError(
      "invalid-argument",
      "userId, planId, and transactionId are required",
    );
  }

  const planSnap = await db.doc(`plans/${planId}`).get();
  if (!planSnap.exists) {
    throw new HttpsError("not-found", "Plan not found");
  }

  const plan = planSnap.data()!;
  const now = new Date();
  const durationDays: number = plan.duration ?? 30;
  const endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  await db.doc(`users/${userId}`).set(
    {
      subscription: {
        planId,
        planName: plan.name ?? planId,
        transactionId,
        status: "active",
        startDate: admin.firestore.Timestamp.fromDate(now),
        endDate: admin.firestore.Timestamp.fromDate(endDate),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );

  logger.info(`Subscription activated for user ${userId}, plan ${planId}`);

  return {
    success: true,
    subscription: {
      planId,
      status: "active",
      startDate: now.toISOString(),
      endDate: endDate.toISOString(),
    },
  };
});

export const checkExpiredSubscriptions = onSchedule(
  { schedule: "every day 00:30", timeZone: "Asia/Kolkata", region: "asia-south1" },
  async () => {
    const now = admin.firestore.Timestamp.now();

    const snapshot = await db
      .collection("users")
      .where("subscription.status", "==", "active")
      .where("subscription.endDate", "<=", now)
      .get();

    if (snapshot.empty) {
      logger.info("No expired subscriptions found");
      return;
    }

    const batch = db.batch();
    let count = 0;

    snapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        "subscription.status": "expired",
        "subscription.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });
      count++;
    });

    await batch.commit();
    logger.info(`Marked ${count} subscription(s) as expired`);
  },
);
