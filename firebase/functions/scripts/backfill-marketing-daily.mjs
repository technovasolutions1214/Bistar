// Backfill the daily marketing rollups (marketingDaily/{date} +
// marketingDailyRevenue/{date}) for every past IST day, reusing the deployed
// rollup logic. Today is intentionally skipped — the dashboard renders today
// live. Re-runnable (each day's doc is overwritten). Verifies at the end that
// the rollup counts sum to the raw purchased-attribution count.
//
// Run as the project OWNER. Build the functions first so lib/ exists:
//   cd firebase/functions && pnpm build      # or: npm run build
//   node scripts/backfill-marketing-daily.mjs
//
// Auth: Application Default Credentials targeting bistar-app. Bistar uses ADC
// (its apps/admin/.env.local FIREBASE_SERVICE_ACCOUNT is empty), so run this in
// Cloud Shell as owner (or anywhere ADC has Firestore write on bistar-app). The
// explicit projectId pins writes to bistar-app, so wrong creds fail safely
// rather than ever touching another project.

import admin from "firebase-admin";

admin.initializeApp({ projectId: "bistar-app" });
const db = admin.firestore();

// Import the compiled rollup AFTER admin is initialized (dynamic import), so the
// module reuses this app instead of trying to init its own.
const { computeAndStoreMarketingDaily } = await import("../lib/marketing-analytics.js");

const IST = 5.5 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const istMidnightUtcMs = (dateStr) => new Date(`${dateStr}T00:00:00+05:30`).getTime();

// Earliest purchased conversion → first IST day to roll up.
const firstSnap = await db.collection("attributions").orderBy("purchasedAt", "asc").limit(1).get();
if (firstSnap.empty) {
  console.log("No purchased attributions found — nothing to roll up.");
  process.exit(0);
}
const firstMs = firstSnap.docs[0].data().purchasedAt.toMillis();
const startDate = istDate(firstMs);
const todayDate = istDate(Date.now());
const yesterdayDate = istDate(Date.now() - DAY);

console.log(`Backfilling marketing rollups: ${startDate} … ${yesterdayDate} (today ${todayDate} is live, skipped)`);

let curMs = istMidnightUtcMs(startDate);
const endMs = istMidnightUtcMs(yesterdayDate);
let rollupSum = 0;
let days = 0;
while (curMs <= endMs) {
  const dateStr = istDate(curMs);
  const r = await computeAndStoreMarketingDaily(dateStr);
  if (r.count || r.revenue) console.log(`  ${dateStr}: ${r.count} conversions, revenue ₹${r.revenue}`);
  rollupSum += r.count;
  days++;
  curMs += DAY;
}
console.log(`\nWrote ${days} day-docs. Rollup conversion sum (excl. today): ${rollupSum}`);

// Verify: rollup sum should equal raw purchased attributions BEFORE today's IST midnight.
const todayMidnightTs = admin.firestore.Timestamp.fromMillis(istMidnightUtcMs(todayDate));
const rawPast = await db.collection("attributions").where("purchasedAt", "<", todayMidnightTs).count().get();
const rawPastCount = rawPast.data().count;
console.log(`Raw purchased attributions before today (IST): ${rawPastCount}`);
console.log(rollupSum === rawPastCount ? "✅ MATCH — rollups are complete + correct" : `❌ MISMATCH (rollup ${rollupSum} vs raw ${rawPastCount})`);
process.exit(0);
