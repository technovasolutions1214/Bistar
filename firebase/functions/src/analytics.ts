import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const aggregateDailyAnalytics = onSchedule(
  { schedule: "every day 00:00", timeZone: "Asia/Kolkata", region: "asia-south1" },
  async () => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);

    const todayStart = new Date(dateStr + "T00:00:00Z");
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    try {
      const newUsersSnap = await db
        .collection("users")
        .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(todayStart))
        .where("createdAt", "<", admin.firestore.Timestamp.fromDate(todayEnd))
        .get();

      const newUsersCount = newUsersSnap.size;

      const activeSubsSnap = await db
        .collection("users")
        .where("subscription.status", "==", "active")
        .get();

      const activeSubscriptions = activeSubsSnap.size;

      const totalUsersSnap = await db.collection("users").count().get();
      const totalUsers = totalUsersSnap.data().count;

      const publishedSnap = await db
        .collection("content")
        .where("status", "==", "published")
        .count()
        .get();
      const totalPublished = publishedSnap.data().count;

      await db.doc(`analytics/${dateStr}`).set({
        date: dateStr,
        newUsers: newUsersCount,
        totalUsers,
        activeSubscriptions,
        totalPublishedContent: totalPublished,
        aggregatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`Daily analytics aggregated for ${dateStr}`, {
        newUsers: newUsersCount,
        totalUsers,
        activeSubscriptions,
        totalPublished,
      });
    } catch (error) {
      logger.error("Failed to aggregate daily analytics", error);
    }
  },
);
