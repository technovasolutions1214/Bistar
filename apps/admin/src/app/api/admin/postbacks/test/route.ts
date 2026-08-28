import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { requireAdminUid } from "@/lib/require-admin";

/**
 * POST /api/admin/postbacks/test  (admin only)
 *
 * Queues a one-off postback so an admin can verify a network's setup before
 * any real money depends on it. It does not send anything itself: it appends a
 * row to `adPostbacks`, exactly like a real conversion does, and the
 * `onAdPostbackQueued` Cloud Function renders and delivers it. Testing through
 * the real path is the point — a test that used a different code path would
 * prove nothing.
 *
 * Two modes:
 *   dryRun: true   — render the URL (API key included from the secret, then
 *                    redacted in the log) and record it WITHOUT calling the
 *                    network. This is the panel's "Preview URL".
 *   dryRun: false  — actually call the network. Manual tests bypass the
 *                    enabled switches on purpose, so you can prove a network
 *                    works before switching it on.
 *
 * The caller polls the returned document id to see the outcome.
 */
const EVENTS = new Set(["landing", "registration", "initiate_checkout", "purchase"]);
const LOG_TTL_DAYS = 60;

export async function POST(request: NextRequest) {
  if (!(await requireAdminUid(request)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const network = String(body.network ?? "").toLowerCase().replace(/[^a-z0-9-_]/g, "");
  const event = String(body.event ?? "purchase");
  if (!network) return NextResponse.json({ error: "network is required" }, { status: 400 });
  if (!EVENTS.has(event)) return NextResponse.json({ error: "Unknown event" }, { status: 400 });

  const dryRun = body.dryRun !== false;
  const revenue =
    typeof body.revenue === "number" && isFinite(body.revenue) && body.revenue >= 0
      ? body.revenue
      : null;
  const clickId =
    (typeof body.clickId === "string" && body.clickId.trim()
      ? body.clickId.trim()
      : `TEST-CLICK-${Date.now().toString(36)}`
    ).slice(0, 256);

  const db = getAdminDb();
  const now = new Date();
  const id = `test_${network}_${event}_${now.getTime().toString(36)}`;

  await db
    .collection("adPostbacks")
    .doc(id)
    .set({
      network,
      event,
      clickId,
      conversionId: id,
      zone: "TEST-ZONE",
      campaign: "TEST-CAMPAIGN",
      creative: "TEST-CREATIVE",
      cost: null,
      txnid: null,
      revenue,
      revenueCurrency: revenue === null ? null : "INR",
      country: "IN",
      source: "manual-test",
      // Survives a re-queue; `source` becomes "retry" and would lose the bypass.
      manualBypass: true,
      status: "queued",
      attempt: 1,
      retryPending: false,
      dryRun,
      createdAt: now,
      expiresAt: new Date(now.getTime() + LOG_TTL_DAYS * 24 * 60 * 60 * 1000),
    });

  return NextResponse.json({ id });
}
