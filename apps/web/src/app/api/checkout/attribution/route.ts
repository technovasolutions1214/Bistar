import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { countryFromLocale, countryFromTimezone, normalizeCountry } from "@/lib/geo";

/**
 * POST /api/checkout/attribution
 *
 * Records the Meta attribution bundle (which pixel/campaign/ad the visitor came
 * from, plus _fbp/_fbc and geo) against a transaction, in a server-only
 * `attributions/{txnid}` doc. The CAPI Purchase trigger reads it on success to
 * fire a server-side event to the right pixel, and the marketing dashboard
 * reads it for conversion analytics.
 *
 * When the visitor arrived from an ad network instead (?net=…&cid=…), the
 * network half of the bundle is written to a SEPARATE `adAttributions/{txnid}`
 * doc. That split is deliberate: `attributions` is readable by marketing staff,
 * while the ad-network S2S postback pipeline — and the panel that configures
 * it — is admin-only. The purchase postback trigger reads `adAttributions`.
 *
 * Called by both guest and logged-in checkouts; the sealed PayU create route
 * and webhook are untouched. Non-critical: failures never block payment.
 */
function clientIp(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || null;
}

// Edge/CDN geo headers, best first. Firebase App Hosting sends none of these —
// they're kept so the same route still works behind Cloudflare/Vercel/App Engine
// — which is why the browser-supplied timezone below is the real fallback.
const GEO_HEADERS = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "x-appengine-country",
  "x-country-code",
  "x-client-geo-country",
  "x-geo-country",
];

function headerCountry(request: NextRequest): string | null {
  for (const h of GEO_HEADERS) {
    const c = normalizeCountry(request.headers.get(h));
    if (c) return c;
  }
  return null;
}

const CITY_HEADERS = ["cf-ipcity", "x-vercel-ip-city", "x-appengine-city", "x-client-geo-city"];

function headerCity(request: NextRequest): string | null {
  for (const h of CITY_HEADERS) {
    const v = request.headers.get(h);
    if (v && v.trim()) return decodeURIComponent(v.trim()).slice(0, 128);
  }
  return null;
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
    // Network slugs are `adNetworks` doc ids — same charset the admin panel allows.
    const slug = (v: unknown) => {
      const s = str(v)?.toLowerCase().replace(/[^a-z0-9-_]/g, "");
      return s || null;
    };

    // Country: edge header if the platform gives us one, else the device's IANA
    // timezone, else the locale's region subtag. On App Hosting only the last
    // two ever fire — before this fallback existed every doc stored country:null
    // and the dashboard's "By country" breakdown was permanently empty.
    const country =
      headerCountry(request) ||
      countryFromTimezone(str(a.tz)) ||
      countryFromLocale(str(a.lang));

    // User agent: App Hosting's front end replaces the client UA with the
    // literal "Google" before the request reaches this route, so the header is
    // worthless here. The browser sends its own navigator.userAgent in the
    // payload; fall back to the header only when it isn't that placeholder.
    const headerUa = (request.headers.get("user-agent") || "").trim();
    const userAgent =
      (typeof a.ua === "string" && a.ua ? a.ua.slice(0, 512) : null) ||
      (headerUa && headerUa !== "Google" ? headerUa.slice(0, 512) : null);

    // The ad-network click, when there is one. Written to its own admin-only
    // collection (see the header) and only when both halves are present — a
    // network without a click id can never be posted back, so an empty doc
    // would just be noise in the deliveries log.
    const adNetwork = slug(a.adNetwork);
    const adClickId = str(a.adClickId);
    const adWrite =
      adNetwork && adClickId
        ? getAdminDb()
            .collection("adAttributions")
            .doc(txnid)
            .set(
              {
                txnid,
                userId: uid,
                network: adNetwork,
                clickId: adClickId,
                zone: str(a.adZone),
                campaign: str(a.adCampaign),
                creative: str(a.adCreative),
                cost: str(a.adCost),
                landedAt: typeof a.adLandedAt === "number" ? new Date(a.adLandedAt) : null,
                country,
                ip: clientIp(request),
                userAgent,
                createdAt: new Date(),
              },
              { merge: true },
            )
        : Promise.resolve();

    const metaWrite = getAdminDb()
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
          country,
          city: headerCity(request),
          timezone: str(a.tz),
          locale: str(a.lang),
          userAgent,
          status: "pending",
          createdAt: new Date(),
        },
        { merge: true }
      );

    // allSettled, not all: a failure writing one half must not lose the other.
    const [meta, ad] = await Promise.allSettled([metaWrite, adWrite]);
    if (meta.status === "rejected") console.error("attribution write failed:", meta.reason);
    if (ad.status === "rejected") console.error("adAttribution write failed:", ad.reason);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("attribution error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
