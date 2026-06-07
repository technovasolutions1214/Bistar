import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

/**
 * POST /api/checkout/attribution
 *
 * Records the Meta attribution bundle (which pixel/campaign/ad the visitor came
 * from, plus _fbp/_fbc and geo) against a transaction, in a server-only
 * `attributions/{txnid}` doc. The CAPI Purchase trigger reads it on success to
 * fire a server-side event to the right pixel, and the marketing dashboard
 * reads it for conversion analytics.
 *
 * Called by both guest and logged-in checkouts; the sealed PayU create route
 * and webhook are untouched. Non-critical: failures never block payment.
 */
function clientIp(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || null;
}

function headerCountry(request: NextRequest): string | null {
  return (
    request.headers.get("cf-ipcountry") ||
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("x-appengine-country") ||
    request.headers.get("x-country-code") ||
    null
  );
}

export async function POST(request: NextRequest) {
  try {
    const m = (request.headers.get("authorization") || "").match(/^Bearer (.+)$/);
    if (!m) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    let decoded;
    try {
      decoded = await getAdminAuth().verifyIdToken(m[1]);
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    const uid = decoded.uid;

    const { txnid, attribution } = await request.json();
    if (!txnid || typeof txnid !== "string") {
      return NextResponse.json({ error: "txnid is required" }, { status: 400 });
    }
    const a: Record<string, unknown> =
      attribution && typeof attribution === "object" ? attribution : {};

    // The transaction must exist and belong to the caller.
    const txSnap = await getAdminDb().collection("transactions").doc(txnid).get();
    if (!txSnap.exists) return NextResponse.json({ error: "Unknown transaction" }, { status: 404 });
    const tx = txSnap.data()!;
    if (tx.userId !== uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const str = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 256) : null);

    await getAdminDb()
      .collection("attributions")
      .doc(txnid)
      .set(
        {
          txnid,
          userId: uid,
          // Revenue (amount/planId/currency) is intentionally NOT stored here:
          // this doc is readable by marketing staff. Revenue lives only on the
          // admin-only transaction and is joined in for admins in the dashboard.
          pixelSlug: str(a.pixelSlug),
          pixelId: str(a.pixelId),
          adAccount: str(a.acct),
          campaignId: str(a.campaignId),
          adsetId: str(a.adsetId),
          adId: str(a.adId),
          placement: str(a.placement),
          utmSource: str(a.utmSource),
          utmCampaign: str(a.utmCampaign),
          fbclid: str(a.fbclid),
          fbp: str(a.fbp),
          fbc: str(a.fbc),
          ip: clientIp(request),
          country: headerCountry(request),
          city: null,
          userAgent: (request.headers.get("user-agent") || "").slice(0, 512) || null,
          status: "pending",
          createdAt: new Date(),
        },
        { merge: true }
      );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("attribution error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
