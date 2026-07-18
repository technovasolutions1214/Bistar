// Backfill the daily general-analytics docs (analytics/{date}) for every past
// IST day, reusing the deployed aggregator logic. The nightly function only
// writes "yesterday", so after fixing the revenue query (which used to throw on
// a missing transactions(status, completedAt) index / never-written completedAt
// field) the historical docs must be recomputed once. Re-runnable (each day's
// doc is merged/overwritten).
//
// Run as the project OWNER. Build the functions first so lib/ exists:
//   cd firebase/functions && npm run build
//   node scripts/backfill-daily-analytics.mjs
//
// Auth: Application Default Credentials targeting bistar-app (run in Cloud Shell
// as owner, or anywhere ADC has Firestore access on bistar-app). The explicit
// projectId pins writes to bistar-app so wrong creds fail safely rather than
// ever touching another project.

import admin from "firebase-admin";

admin.initializeApp({ projectId: "bistar-app" });
const db = admin.firestore();

// Import the compiled aggregator AFTER admin is initialized (dynamic import), so
// the module reuses this app instead of trying to init its own.
const { computeAndStoreDailyAnalytics } = await import("../lib/analytics.js");

const IST = 5.5 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const istMidnightUtcMs = (dateStr) => new Date(`${dateStr}T00:00:00+05:30`).getTime();

// Earliest activity (users OR transactions) → first IST day to aggregate.
async function earliestMs(collection, field) {
  const s = await db.collection(collection).orderBy(field, "asc").limit(1).get();
  if (s.empty) return null;
  const v = s.docs[0].data()[field];
  return v?.toMillis ? v.toMillis() : null;
}
const candidates = (
  await Promise.all([
    earliestMs("users", "createdAt"),
    earliestMs("transactions", "createdAt"),
  ])
).filter((x) => typeof x === "number");
if (!candidates.length) {
  console.log("No users or transactions found — nothing to aggregate.");
  process.exit(0);
}
const startMs = Math.min(...candidates);
const startDate = istDate(startMs);
const todayDate = istDate(Date.now());

console.log(`Backfilling analytics/{date}: ${startDate} … ${todayDate} (inclusive)`);

let curMs = istMidnightUtcMs(startDate);
const endMs = istMidnightUtcMs(todayDate); // include today so the totals snapshot is current
let revenueSum = 0;
let days = 0;
while (curMs <= endMs) {
  const dateStr = istDate(curMs);
  const r = await computeAndStoreDailyAnalytics(dateStr);
  if (r.newUsers || r.newSubscriptions || r.revenue)
    console.log(`  ${dateStr}: +${r.newUsers} users, +${r.newSubscriptions} subs, revenue ₹${r.revenue}`);
  revenueSum += r.revenue;
  days++;
  curMs += DAY;
}
console.log(`\nWrote ${days} day-docs. Total revenue across window: ₹${revenueSum}`);
process.exit(0);
