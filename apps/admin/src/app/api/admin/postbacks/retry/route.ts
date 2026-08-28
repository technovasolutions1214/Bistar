import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireAdminUid } from "@/lib/require-admin";

/**
 * POST /api/admin/postbacks/retry  (admin only)
 *
 * Re-queues one delivery from the Deliveries tab. Same mechanism the scheduled
 * sweeper uses: a NEW row carrying the original's context is created, so the
 * failed attempt stays in the log rather than being overwritten, and the
 * network still sees the same `conversionId` and click id.
 */
const LOG_TTL_DAYS = 60;
const MAX_MANUAL_RETRIES = 20;

export async function POST(request: NextRequest) {
  if (!(await requireAdminUid(request)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  if (!id || typeof id !== "string")
    return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getAdminDb();
  const snap = await db.collection("adPostbacks").doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: "No such delivery" }, { status: 404 });
  const row = snap.data()!;

  const now = new Date();
  const rootId = id.replace(/__r\d+$/, "");
  const context = {
    network: row.network,
    event: row.event,
    clickId: row.clickId,
    conversionId: row.conversionId ?? rootId,
    zone: row.zone ?? null,
    campaign: row.campaign ?? null,
    creative: row.creative ?? null,
    cost: row.cost ?? null,
    txnid: row.txnid ?? null,
    revenue: row.revenue ?? null,
    revenueCurrency: row.revenueCurrency ?? null,
    country: row.country ?? null,
    source: "retry",
    // `source` becomes "retry", so a retried manual test would otherwise be
    // skipped as network-disabled — the bypass travels in its own field.
    manualBypass: row.source === "manual-test" || row.manualBypass === true,
    parentId: id,
    status: "queued",
    retryPending: false,
    dryRun: false,
    createdAt: now,
    expiresAt: new Date(now.getTime() + LOG_TTL_DAYS * 24 * 60 * 60 * 1000),
  };

  // Walk forward to the first free `__rN` slot so repeated manual retries each
  // get their own row instead of silently colliding with an earlier one.
  let attempt = (typeof row.attempt === "number" ? row.attempt : 1) + 1;
  for (let i = 0; i < MAX_MANUAL_RETRIES; i++, attempt++) {
    try {
      await db.collection("adPostbacks").doc(`${rootId}__r${attempt}`).create({ ...context, attempt });
      await snap.ref.set({ retryPending: false }, { merge: true });
      return NextResponse.json({ id: `${rootId}__r${attempt}` });
    } catch (err) {
      if ((err as { code?: number })?.code !== 6) throw err; // not ALREADY_EXISTS
    }
  }
  return NextResponse.json({ error: "Too many retries for this delivery." }, { status: 409 });
}
