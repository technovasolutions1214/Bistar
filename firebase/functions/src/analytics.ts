import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Returns the IST calendar date for a given instant as YYYY-MM-DD.
function istDateString(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// IST midnight (00:00 +05:30) on a given IST date, expressed as a UTC instant.
function istMidnightUtc(istDateStr: string): Date {
  return new Date(`${istDateStr}T00:00:00+05:30`);
}

interface DailyAggregate {
  date: string; // IST calendar date YYYY-MM-DD
  windowStart: string; // ISO UTC instant for IST 00:00 of `date`
  windowEnd: string; // ISO UTC instant for IST 00:00 of `date + 1`
  // Per-day deltas (counted within [windowStart, windowEnd))
  newUsers: number;
  newSubscriptions: number;
  revenue: number;
  revenueCurrency: string;
  // Snapshots taken at windowEnd
  totalUsers: number;
  activeSubscriptions: number;
  totalPublishedContent: number;
}

// Compute analytics for a single IST date and write to analytics/{date}.
// Exposed so a one-off backfill or manual trigger can reuse it.
export async function computeAndStoreDailyAnalytics(istDateStr: string): Promise<DailyAggregate> {
  const windowStart = istMidnightUtc(istDateStr);
  const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

  const startTs = admin.firestore.Timestamp.fromDate(windowStart);
  const endTs = admin.firestore.Timestamp.fromDate(windowEnd);

  // Per-day deltas
  const newUsersSnap = await db
    .collection("users")
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<", endTs)
    .count()
    .get();
  const newUsers = newUsersSnap.data().count;

  const newSubsSnap = await db
    .collection("users")
    .where("subscription.startDate", ">=", startTs)
    .where("subscription.startDate", "<", endTs)
    .count()
    .get();
  const newSubscriptions = newSubsSnap.data().count;

  const revenueSnap = await db
    .collection("transactions")
    .where("status", "==", "success")
    .where("completedAt", ">=", startTs)
    .where("completedAt", "<", endTs)
    .get();
  let revenue = 0;
  let revenueCurrency = "INR";
  for (const t of revenueSnap.docs) {
    const data = t.data();
    revenue += Number(data.amount ?? 0);
    if (data.currency) revenueCurrency = data.currency;
  }

  // Snapshots (as of windowEnd, which is the moment we run the aggregation)
  const totalUsersSnap = await db.collection("users").count().get();
  const totalUsers = totalUsersSnap.data().count;

  const activeSubsSnap = await db
    .collection("users")
    .where("subscription.status", "==", "active")
    .count()
    .get();
  const activeSubscriptions = activeSubsSnap.data().count;

  const publishedSnap = await db
    .collection("content")
    .where("status", "==", "published")
    .count()
    .get();
  const totalPublishedContent = publishedSnap.data().count;

  const result: DailyAggregate = {
    date: istDateStr,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    newUsers,
    newSubscriptions,
    revenue,
    revenueCurrency,
    totalUsers,
    activeSubscriptions,
    totalPublishedContent,
  };

  await db.doc(`analytics/${istDateStr}`).set(
    {
      ...result,
      aggregatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return result;
}

// Runs at IST midnight and aggregates the IST calendar day that just ended.
export const aggregateDailyAnalytics = onSchedule(
  { schedule: "every day 00:00", timeZone: "Asia/Kolkata", region: "asia-south1" },
  async () => {
    try {
      const nowUtc = new Date();
      // The day that JUST ended in IST: shift back 24h, then take IST date.
      const yesterdayIst = istDateString(new Date(nowUtc.getTime() - 24 * 60 * 60 * 1000));
      const result = await computeAndStoreDailyAnalytics(yesterdayIst);
      logger.info(`Daily analytics aggregated for IST ${yesterdayIst}`, result);
    } catch (error) {
      logger.error("Failed to aggregate daily analytics", error);
    }
  },
);
