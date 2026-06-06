// First-party attribution capture for Meta ads.
//
// On landing we read the campaign params we put on ad URLs (?c=<pixelSlug>,
// &acct, utm_*, and Meta's dynamic macros campaign_id/adset_id/ad_id/placement)
// plus the click id (fbclid), and persist them in a first-party cookie that
// survives the funnel. At checkout we add Meta's own _fbp/_fbc cookies and send
// the bundle to the server so the CAPI Purchase event can attribute correctly.

const ATTR_COOKIE = "nf_attr";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface Attribution {
  pixelSlug?: string;
  pixelId?: string;
  acct?: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  placement?: string;
  utmSource?: string;
  utmCampaign?: string;
  fbclid?: string;
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}

function readStored(): Attribution {
  const raw = readCookie(ATTR_COOKIE);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Attribution;
  } catch {
    return {};
  }
}

/**
 * Capture campaign params from the current URL into the cookie. Last-touch: a
 * fresh paid click overwrites the previous campaign; organic visits (no params)
 * keep whatever was last stored. `resolved` carries the pixel the loader picked.
 */
export function captureAttribution(resolved?: { pixelSlug?: string; pixelId?: string }) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  const keys = ["c", "acct", "utm_source", "utm_campaign", "campaign_id", "adset_id", "ad_id", "placement", "fbclid"];
  const hasParams = keys.some((k) => q.get(k));

  let attr = readStored();
  if (hasParams) {
    attr = {
      pixelSlug: q.get("c") || attr.pixelSlug,
      acct: q.get("acct") || undefined,
      campaignId: q.get("campaign_id") || undefined,
      adsetId: q.get("adset_id") || undefined,
      adId: q.get("ad_id") || undefined,
      placement: q.get("placement") || undefined,
      utmSource: q.get("utm_source") || undefined,
      utmCampaign: q.get("utm_campaign") || undefined,
      fbclid: q.get("fbclid") || undefined,
    };
  }
  if (resolved?.pixelSlug) attr.pixelSlug = resolved.pixelSlug;
  if (resolved?.pixelId) attr.pixelId = resolved.pixelId;

  writeCookie(ATTR_COOKIE, JSON.stringify(attr));
}

/** The full attribution bundle to send to the server at checkout. */
export function getAttribution(): Attribution & { fbp?: string; fbc?: string } {
  return {
    ...readStored(),
    fbp: readCookie("_fbp"),
    fbc: readCookie("_fbc"),
  };
}
