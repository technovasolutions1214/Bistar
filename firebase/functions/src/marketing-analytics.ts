import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ---------------------------------------------------------------------------
// Daily marketing rollups. The dashboard used to read raw `attributions` and
// aggregate client-side, which doesn't scale (Firestore caps a query at 10k
// docs, and reads grow with conversions). Instead we pre-aggregate ONE small
// doc per IST day and the dashboard reads those (≈ window-days docs, regardless
// of conversion volume) + a small live query for today.
//
// Two docs per day to preserve the data-layer revenue split:
//   marketingDaily/{date}        — COUNTS + CAPI (marketing-staff + admin readable)
//   marketingDailyRevenue/{date} — REVENUE (admin readable only)
// Both server-written only (Firestore rules deny client writes).
//
// Each doc carries a full per-pixel breakdown (byPixel[slug] with its own
// sub-breakdowns), so the dashboard's pixel filter is also served from rollups
// with no raw read and no composite index.
// ---------------------------------------------------------------------------

const NONE = "(none)"; // sentinel for a missing dimension value (NOT __none__ — reserved)

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDateString(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function istMidnightUtc(istDateStr: string): Date {
  return new Date(`${istDateStr}T00:00:00+05:30`);
}

type NumMap = Record<string, number>;
interface Capi {
  sent: number;
  error: number;
  skipped: number;
}
interface PixelCounts {
  count: number;
  capi: Capi;
  byAccount: NumMap;
  byCampaign: NumMap;
  byCountry: NumMap;
}
interface PixelRevenue {
  revenue: number;
  byAccount: NumMap;
  byCampaign: NumMap;
  byCountry: NumMap;
}

function bump(m: NumMap, key: string | undefined, n: number) {
  const k = key || NONE;
  m[k] = (m[k] || 0) + n;
}

/**
 * Aggregate one IST day's purchased conversions into the two rollup docs.
 * Exported so the backfill script and a manual re-run can reuse it.
 */
export async function computeAndStoreMarketingDaily(istDateStr: string): Promise<{ count: number; revenue: number }> {
  const start = istMidnightUtc(istDateStr);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const startTs = admin.firestore.Timestamp.fromDate(start);
  const endTs = admin.firestore.Timestamp.fromDate(end);

  // Purchased conversions in this IST day (single-field range on purchasedAt —
  // only purchased docs carry purchasedAt, so this returns purchases only).
  const attrSnap = await db
    .collection("attributions")
    .where("purchasedAt", ">=", startTs)
    .where("purchasedAt", "<", endTs)
    .get();

  // Revenue lives on transactions (doc id == txnid == attribution id). Fetch the
  // matching transactions in batches to sum revenue per conversion.
  const ids = attrSnap.docs.map((d) => d.id);
  const amountById: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((id) => db.doc(`transactions/${id}`));
    if (!refs.length) break;
    const txDocs = await db.getAll(...refs);
    for (const t of txDocs) {
      if (!t.exists) continue;
      const x = t.data()!;
      if (x.status === "success" && typeof x.amount === "number") amountById[t.id] = x.amount;
    }
  }

  // ---- Counts (staff-readable) ----
  let totalCount = 0;
  const capi: Capi = { sent: 0, error: 0, skipped: 0 };
  const byAccount: NumMap = {};
  const byCampaign: NumMap = {};
  const byCountry: NumMap = {};
  const byPixel: Record<string, PixelCounts> = {};

  // ---- Revenue (admin-only) ----
  let totalRevenue = 0;
  const revByAccount: NumMap = {};
  const revByCampaign: NumMap = {};
  const revByCountry: NumMap = {};
  const revByPixel: Record<string, PixelRevenue> = {};

  for (const d of attrSnap.docs) {
    const x = d.data();
    const amt = amountById[d.id] || 0;
    const pixel = (x.pixelSlug as string | undefined) || NONE;
    const acct = x.adAccount as string | undefined;
    const camp = x.campaignId as string | undefined;
    const country = x.country as string | undefined;
    const capiKey: keyof Capi = x.capiStatus === "sent" ? "sent" : x.capiStatus === "error" ? "error" : "skipped";

    totalCount++;
    totalRevenue += amt;
    capi[capiKey]++;
    bump(byAccount, acct, 1);
    bump(byCampaign, camp, 1);
    bump(byCountry, country, 1);
    bump(revByAccount, acct, amt);
    bump(revByCampaign, camp, amt);
    bump(revByCountry, country, amt);

    const p = (byPixel[pixel] ??= { count: 0, capi: { sent: 0, error: 0, skipped: 0 }, byAccount: {}, byCampaign: {}, byCountry: {} });
    p.count++;
    p.capi[capiKey]++;
    bump(p.byAccount, acct, 1);
    bump(p.byCampaign, camp, 1);
    bump(p.byCountry, country, 1);

    const rp = (revByPixel[pixel] ??= { revenue: 0, byAccount: {}, byCampaign: {}, byCountry: {} });
    rp.revenue += amt;
    bump(rp.byAccount, acct, amt);
    bump(rp.byCampaign, camp, amt);
    bump(rp.byCountry, country, amt);
  }

  const aggregatedAt = admin.firestore.FieldValue.serverTimestamp();
  await db.doc(`marketingDaily/${istDateStr}`).set(
    { date: istDateStr, totalCount, capi, byAccount, byCampaign, byCountry, byPixel, aggregatedAt },
    { merge: false },
  );
  await db.doc(`marketingDailyRevenue/${istDateStr}`).set(
    { date: istDateStr, totalRevenue, byAccount: revByAccount, byCampaign: revByCampaign, byCountry: revByCountry, byPixel: revByPixel, aggregatedAt },
    { merge: false },
  );

  return { count: totalCount, revenue: totalRevenue };
}

// Runs shortly after IST midnight and rolls up the IST day that just ended.
export const aggregateMarketingDaily = onSchedule(
  { schedule: "every day 00:10", timeZone: "Asia/Kolkata", region: "asia-south1" },
  async () => {
    try {
      const nowUtc = new Date();
      const yesterdayIst = istDateString(new Date(nowUtc.getTime() - 24 * 60 * 60 * 1000));
      const r = await computeAndStoreMarketingDaily(yesterdayIst);
      logger.info(`Marketing rollup for IST ${yesterdayIst}: ${r.count} conversions, revenue ${r.revenue}`);
    } catch (error) {
      logger.error("Failed to aggregate marketing daily rollup", error);
    }
  },
);
