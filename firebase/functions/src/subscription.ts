import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

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
