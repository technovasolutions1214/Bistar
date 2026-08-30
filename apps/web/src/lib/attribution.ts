// First-party attribution capture for paid traffic.
//
// Two sources share one last-touch record:
//
//   * Meta ads — ?c=<pixelSlug>, &acct, utm_*, Meta's dynamic macros
//     (campaign_id/adset_id/ad_id/placement) and the click id (fbclid).
//   * Ad networks (PropellerAds, RichAds, EvaDav, AdMaven, PopAds, PopCash,
//     HilltopAds) — ?net=<network slug> plus the network's click id in &cid,
//     which the network substitutes from its own macro. The click id is the
//     token we must echo back in the S2S postback for the network to credit
//     the conversion, so losing it means losing the conversion.
//
// Everything lands in ONE first-party cookie that survives the funnel. One
// cookie is deliberate: a fresh paid click from either source replaces the
// whole record, so we can never postback an ad-network click id for a
// conversion that actually came from a later Meta click (or vice versa).
//
// At checkout we add Meta's own _fbp/_fbc cookies and send the bundle to the
// server, which splits it: the Meta half into `attributions/{txnid}` (marketing
// readable) and the ad-network half into `adAttributions/{txnid}` (admin only).

const ATTR_COOKIE = "nf_attr";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_CLICK_ID_LEN = 256;
// The reporting extras are short ids; keeping them short keeps the whole
// last-touch record comfortably inside the 4KB a cookie is allowed.
const MAX_EXTRA_LEN = 128;

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
  // --- Ad-network (S2S postback) click ---
  /** Network slug from ?net= — must match an `adNetworks` doc id. */
  adNetwork?: string;
  /** The network's click id from ?cid= (or an alias). Echoed in the postback. */
  adClickId?: string;
  /** Zone / site / source id from ?zone=. */
  adZone?: string;
  /** The network's own campaign id from ?camp=. */
  adCampaign?: string;
  /** Creative / banner id from ?cre=. */
  adCreative?: string;
  /** What the network charged for the click, from ?cost=. */
  adCost?: string;
  /** Epoch ms of the ad click, for delay-window diagnostics. */
  adLandedAt?: number;
}

/** Query params we read for the ad-network click. `cid` aliases exist only so a
 *  campaign already built with a tracker's own naming keeps working. */
const AD_PARAMS = {
  network: ["net", "network"],
  clickId: ["cid", "click_id", "clickid", "subid", "sub_id", "visitor_id"],
  zone: ["zone", "zoneid", "zone_id", "site_id"],
  campaign: ["camp", "campaign"],
  creative: ["cre", "creative", "banner_id"],
  cost: ["cost", "bid", "price"],
} as const;

/**
 * Params whose presence means "this is a fresh paid click", which REPLACES the
 * whole last-touch record.
 *
 * Only `net` / `network` from the ad side, deliberately — NOT the aliases in
 * AD_PARAMS. Those aliases exist so `pick()` can find a click id under whatever
 * name a campaign happens to use, but several of them (`campaign`, `creative`,
 * `zone`, `cost`, `price`, `bid`) are ordinary words that appear on plenty of
 * organic URLs. Treating one of those as a paid click would wipe a real Meta or
 * ad-network attribution on an internal link. `net` is the only param that can
 * actually route a conversion, so it is the only one that may start a record.
 */
const TOUCH_PARAMS: string[] = [
  "c",
  "acct",
  "utm_source",
  "utm_campaign",
  "campaign_id",
  "adset_id",
  "ad_id",
  "placement",
  "fbclid",
  ...AD_PARAMS.network,
];

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

/** First non-empty value among `names`, bounded so a hostile URL can't bloat
 *  the cookie (the server bounds it again). */
function pick(q: URLSearchParams, names: readonly string[], max = MAX_EXTRA_LEN): string | undefined {
  for (const n of names) {
    const v = q.get(n);
    if (v && v.trim()) return v.trim().slice(0, max);
  }
  return undefined;
}

/**
 * True when a value is a macro the network failed to substitute, so the literal
 * token arrived instead of a value — ${SUBID}, {CLICKID}, [clickid],
 * {:click_id}, {{ctoken}}, [IMPRESSIONID].
 *
 * This is the commonest ad-network setup mistake (a macro copied from the wrong
 * network's docs) and it is silent: nothing errors, the click id is just junk.
 * Storing it would produce a postback that can never attribute while being
 * logged as a perfectly healthy delivery — the worst outcome, because it looks
 * like it works. Seen live: a PropellerAds test banner expands ${SUBID} for real
 * but leaves {zoneid} untouched.
 */
function isUnexpandedMacro(v: string | undefined): boolean {
  if (!v) return false;
  return /^\$?\{\{?[^}]*\}\}?$/.test(v) || /^\[[^\]]*\]$/.test(v);
}

/** A captured value, or undefined when the network left the macro unexpanded. */
function clean(v: string | undefined): string | undefined {
  return isUnexpandedMacro(v) ? undefined : v;
}


/** Network slugs are doc ids in `adNetworks` — normalise to the same charset
 *  the admin panel allows so a stray uppercase in an ad URL still matches. */
function normalizeSlug(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase().replace(/[^a-z0-9-_]/g, "");
  return s || undefined;
}

/**
 * Capture campaign params from the current URL into the cookie. Last-touch: a
 * fresh paid click overwrites the previous campaign; organic visits (no params)
 * keep whatever was last stored. `resolved` carries the pixel the loader picked.
 *
 * Returns the ad-network click id when THIS page load is a fresh ad-network
 * click, so the caller can fire the network's "landing" event exactly once per
 * click instead of on every route change.
 */
export function captureAttribution(resolved?: { pixelSlug?: string; pixelId?: string }): {
  freshAdClick: boolean;
} {
  if (typeof window === "undefined") return { freshAdClick: false };
  const q = new URLSearchParams(window.location.search);
  const hasParams = TOUCH_PARAMS.some((k) => q.get(k));

  let attr = readStored();
  let freshAdClick = false;

  if (hasParams) {
    const adNetwork = normalizeSlug(pick(q, AD_PARAMS.network));
    const adClickId = clean(pick(q, AD_PARAMS.clickId, MAX_CLICK_ID_LEN));
    freshAdClick = !!(adNetwork && adClickId);

    // Every value goes through pick() so it is bounded. An unbounded Meta param
    // on a hostile URL could push the record past the 4KB a cookie is allowed,
    // and the browser would then drop the WHOLE write — including the click id.
    attr = {
      pixelSlug: pick(q, ["c"]) || attr.pixelSlug,
      acct: pick(q, ["acct"]),
      campaignId: pick(q, ["campaign_id"]),
      adsetId: pick(q, ["adset_id"]),
      adId: pick(q, ["ad_id"]),
      placement: pick(q, ["placement"]),
      utmSource: pick(q, ["utm_source"]),
      utmCampaign: pick(q, ["utm_campaign"]),
      fbclid: pick(q, ["fbclid"], MAX_CLICK_ID_LEN),
      adNetwork,
      adClickId,
      adZone: clean(pick(q, AD_PARAMS.zone)),
      adCampaign: clean(pick(q, AD_PARAMS.campaign)),
      adCreative: clean(pick(q, AD_PARAMS.creative)),
      adCost: clean(pick(q, AD_PARAMS.cost)),
      adLandedAt: freshAdClick ? Date.now() : undefined,
    };
  }
  if (resolved?.pixelSlug) attr.pixelSlug = resolved.pixelSlug;
  if (resolved?.pixelId) attr.pixelId = resolved.pixelId;

  writeCookie(ATTR_COOKIE, JSON.stringify(attr));
  return { freshAdClick };
}

/**
 * The full attribution bundle to send to the server at checkout.
 *
 * `ua`, `tz` and `lang` are read live off the device rather than the cookie —
 * they describe the browser making the purchase, not the campaign it arrived
 * from. The server needs them because Firebase App Hosting's front end rewrites
 * the User-Agent header to the literal string "Google" and forwards no geo
 * header at all, so neither the real user agent nor the country survives the
 * trip to the API route. Meta's CAPI scores match quality on both.
 */
export function getAttribution(): Attribution & {
  fbp?: string;
  fbc?: string;
  ua?: string;
  tz?: string;
  lang?: string;
} {
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    tz = undefined;
  }

  return {
    ...readStored(),
    fbp: readCookie("_fbp"),
    fbc: readCookie("_fbc"),
    ua: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    tz,
    lang: typeof navigator !== "undefined" ? navigator.language : undefined,
  };
}

/** Pre-purchase events an ad network can be told about. `purchase` is NOT here
 *  on purpose: the money event is raised server-side from the confirmed PayU
 *  transaction, where the browser cannot fabricate it. */
export type AdEvent = "landing" | "registration" | "initiate_checkout";

/**
 * Best-effort: ask the server to postback a pre-purchase event to the network
 * this visitor came from. No-ops for organic traffic. Never awaited and never
 * throws — an ad-network outage must not be able to affect the funnel.
 *
 * The server drops the call unless the network AND that event are enabled in
 * the Ad Networks panel, and de-duplicates per (network, click id, event), so
 * calling this more than once for the same click is harmless.
 */
export function reportAdEvent(event: AdEvent, extra?: { value?: number }): void {
  if (typeof window === "undefined") return;
  const a = readStored();
  if (!a.adNetwork || !a.adClickId) return;

  const payload = {
    event,
    network: a.adNetwork,
    clickId: a.adClickId,
    zone: a.adZone,
    campaign: a.adCampaign,
    creative: a.adCreative,
    cost: a.adCost,
    // The server accepts a value only on initiate_checkout and clamps it — it
    // is a hint, not a number the network is billed on.
    value: extra?.value,
  };

  try {
    const body = JSON.stringify(payload);
    // sendBeacon survives the page teardown that follows a checkout redirect;
    // fetch+keepalive is the fallback where it is unavailable.
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(
        "/api/track/ad-event",
        new Blob([body], { type: "application/json" }),
      );
      if (ok) return;
    }
    void fetch("/api/track/ad-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never let tracking break the page */
  }
}
