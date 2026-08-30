// Catalog for the Ad Networks panel.
//
// Two halves:
//   * EVENT_CATALOG   — the conversions we can report, and exactly where in our
//                       own code each one is raised.
//   * AD_NETWORKS     — one entry per traffic source we buy from, carrying the
//                       macro tokens for its landing URL and a starting point
//                       for its postback URL.
//
// The catalog is DOCUMENTATION AND DEFAULTS ONLY. Live configuration lives in
// Firestore (`adNetworks/{slug}`) and every field here can be overridden in the
// panel, because ad networks change their macros and endpoints without notice
// and several of them issue a postback URL that is unique to your account.
// `templateConfidence` says how far each prefilled template should be trusted.

export type AdEventKey = "landing" | "registration" | "initiate_checkout" | "purchase";

export interface EventDef {
  key: AdEventKey;
  label: string;
  /** What the event means to an ad network's optimiser. */
  what: string;
  /** The exact place in our product that raises it. */
  when: string;
  /** server = raised from verified server state; browser = raised by the page. */
  trust: "server" | "browser";
  defaultOn: boolean;
}

/**
 * Order matters — this is funnel order, and the panel renders it as a funnel.
 *
 * Only `purchase` is server-verified. The other three are raised by the browser
 * through /api/track/ad-event, which de-duplicates per (network, click, event)
 * but cannot prove the visitor is real. Optimise on purchase; use the rest as
 * volume signals for networks whose algorithm wants an earlier event.
 */
export const EVENT_CATALOG: EventDef[] = [
  {
    key: "landing",
    label: "Landing",
    what: "The click arrived and our page rendered. Some networks use it to validate that their clicks reach you at all.",
    when: "First page load of a URL carrying ?net= and a click id (PixelLoader).",
    trust: "browser",
    defaultOn: false,
  },
  {
    key: "registration",
    label: "Registration",
    what: "A new account was created — the classic mid-funnel 'lead'.",
    when: "First-time user doc creation after Google sign-in or MSG91 OTP (/auth/login).",
    trust: "browser",
    defaultOn: false,
  },
  {
    key: "initiate_checkout",
    label: "Initiate checkout",
    what: "The visitor opened the payment window. Useful where purchase volume is too thin to train on.",
    when: "Subscribe pressed on /plans or the homepage quick checkout.",
    trust: "browser",
    defaultOn: false,
  },
  {
    key: "purchase",
    label: "Purchase",
    what: "A subscription was paid for. This is the money event — the one worth optimising against.",
    when: "A transaction flips to success after PayU's hash-verified webhook (onPurchaseSendAdPostbacks).",
    trust: "server",
    defaultOn: true,
  },
];

/** Macros usable in a postback URL or body. Double braces so a network's own
 *  `${SUBID}` / `{clickid}` syntax passes through untouched. */
export const TEMPLATE_MACROS: { macro: string; meaning: string }[] = [
  { macro: "{{click_id}}", meaning: "The network's click id, captured from ?cid= on landing. Almost every postback needs this." },
  { macro: "{{payout}}", meaning: "The conversion value, computed by the payout rules below. Empty unless a payout mode is set." },
  { macro: "{{currency}}", meaning: "The payout currency you selected for this network." },
  { macro: "{{goal}}", meaning: "The network's goal / conversion-type id you set for this event." },
  { macro: "{{event}}", meaning: "Our event key: landing, registration, initiate_checkout or purchase." },
  { macro: "{{conversion_id}}", meaning: "Stable unique id for this conversion — same value across retries, so a network that de-duplicates counts it once." },
  { macro: "{{txn_id}}", meaning: "Our PayU transaction id. Empty for pre-purchase events." },
  { macro: "{{revenue}}", meaning: "The raw order amount before any FX conversion." },
  { macro: "{{revenue_currency}}", meaning: "Currency of the raw order amount (INR)." },
  { macro: "{{zone}}", meaning: "Zone / site / source id from ?zone= on landing." },
  { macro: "{{campaign}}", meaning: "The network's campaign id from ?camp= on landing." },
  { macro: "{{creative}}", meaning: "Creative / banner id from ?cre= on landing." },
  { macro: "{{cost}}", meaning: "What the network charged for the click, from ?cost= on landing." },
  { macro: "{{country}}", meaning: "Two-letter country we resolved for the visitor." },
  { macro: "{{network}}", meaning: "This network's slug." },
  { macro: "{{timestamp}}", meaning: "Unix seconds at the moment we send." },
  { macro: "{{api_key}}", meaning: "The API key saved for this network. Stored write-only and redacted everywhere it is logged." },
];

/** A macro the network substitutes into OUR landing URL. */
export interface NetworkMacro {
  /** The query parameter on our landing URL. */
  ourParam: string;
  /** The token the network replaces, verbatim — delimiters matter. */
  macro: string;
  meaning: string;
  /** Click id is mandatory; the rest are reporting extras. */
  required?: boolean;
}

export type Confidence = "confirmed" | "verify" | "account-specific";

export interface AdNetworkDef {
  slug: string;
  name: string;
  site: string;
  docsUrl?: string;
  /** Traffic type, so whoever reads this knows what they are buying. */
  kind: string;
  macros: NetworkMacro[];
  /** Where in the network's UI the landing/target URL is set. */
  landingUrlField: string;
  /** Starting point for the postback URL. Always editable in the panel. */
  postbackTemplate: string;
  method: "GET" | "POST";
  /** Menu path to the screen where the postback is configured or copied. */
  dashboardPath: string;
  /** How far the prefilled template can be trusted before you check it. */
  templateConfidence: Confidence;
  /** What that confidence level means for THIS network, in one sentence. */
  confidenceNote: string;
  /** The account-specific credential baked into that network's postback URL. */
  credentialNote: string;
  /** Text in a 200 response that actually means the call was rejected. */
  failurePattern?: string;
  supportsPayout: boolean;
  /** What currency the network reads the payout number as, and how sure we are. */
  payoutNote: string;
  supportsGoal: boolean;
  /** True when the goal parameter is mandatory on EVERY event — RichAds rejects
   *  a call with no `action`, whereas a blank goal is the CORRECT way to send
   *  PropellerAds' primary conversion and HilltopAds' main conversion. */
  goalRequired?: boolean;
  /** Goal values to seed per event, where the network documents them. */
  defaultGoals?: Partial<Record<AdEventKey, string>>;
  /** Things that will cost money if you get them wrong. */
  caveats: string[];
}

/**
 * Build the destination URL to paste into a campaign, with that network's own
 * macros in the values. `?net=` is what routes the conversion back to the right
 * network config, and `?cid=` is the click id we must echo in the postback.
 */
export function landingUrl(net: AdNetworkDef, siteUrl: string, path = "/"): string {
  const base = (siteUrl || "https://your-site.com").replace(/\/+$/, "");
  const qs = net.macros.map((m) => `${m.ourParam}=${m.macro}`).join("&");
  return `${base}${path}?net=${net.slug}&${qs}`;
}

// ---------------------------------------------------------------------------
// The seven networks.
//
// Every macro token below is reproduced with its exact delimiters, because that
// is the single most expensive thing to get wrong: a network that does not
// recognise a token substitutes NOTHING and passes the literal text through, so
// the click id arrives as "${SUBID}" or "[clickid]" and every conversion from
// that campaign is silently unattributable. There is no error anywhere — the
// campaign just looks like it does not convert.
//
// `templateConfidence` is the other thing to read before spending:
//   confirmed        — one universal endpoint, published by the network itself.
//   account-specific — the network GENERATES your postback URL with your own
//                      ids in it. Copy it out of their dashboard; the prefill
//                      here only shows you the shape.
// ---------------------------------------------------------------------------

export const AD_NETWORKS: AdNetworkDef[] = [
  {
    slug: "propellerads",
    name: "PropellerAds",
    site: "partners.propellerads.com",
    docsUrl: "https://propellerads.com/help/",
    kind: "Push, in-page push, onclick/popunder, interstitial, survey exit",
    landingUrlField: "Campaign editor → Target URL (the token list sits directly beneath the field)",
    macros: [
      { ourParam: "cid", macro: "${SUBID}", meaning: "The click id. Dollar sign + curly braces, SUBID uppercase.", required: true },
      { ourParam: "zone", macro: "{zoneid}", meaning: "Ad zone / placement — the dimension you white- and blacklist on." },
      { ourParam: "camp", macro: "{campaignid}", meaning: "PropellerAds campaign id." },
      { ourParam: "cre", macro: "{bannerid}", meaning: "Creative / banner id." },
      { ourParam: "cost", macro: "{cost}", meaning: "What you paid for this click." },
    ],
    postbackTemplate:
      "https://ad.propellerads.com/conversion.php?aid=YOUR_AID&pid=&tid=YOUR_TID&visitor_id={{click_id}}&payout={{payout}}&goal={{goal}}",
    method: "GET",
    dashboardPath:
      'Tracking tab → "Select a tracker or a CPA network" → "Other tracker or CPA network" → "Copy this S2S Postback URL"',
    templateConfidence: "account-specific",
    confidenceNote:
      "Host, path and parameter names are well corroborated, but aid and tid are issued to your account (and per tracker slot). PropellerAds' own guides warn that conversions are not tracked if you do not insert your real aid and tid.",
    credentialNote:
      "aid + tid, both inside the URL. There is no API key — the URL itself is the credential, so keep it server-side.",
    supportsPayout: true,
    payoutNote:
      "Parameter is payout, a plain decimal. The currency is NOT documented — PropellerAds operates in USD, EUR and GBP, so check your account currency and convert to it.",
    supportsGoal: true,
    defaultGoals: { registration: "2" },
    caveats: [
      'Leave pid exactly as the dashboard emits it — empty, filled or absent. Its meaning is undocumented, so do not add or remove it.',
      "goal selects the funnel level: 1 = primary, 2 = a secondary event such as registration, 3 = a high-value event such as a subscription. The primary conversion may also be sent with no goal at all — which is why Purchase ships here with the goal left blank: only ONE level feeds the CPA Goal optimiser, and the primary level is the one it targets by default.",
      "Send the SAME click id on every goal level for a visitor.",
      "PropellerAds publishes conflicting spellings elsewhere ({zoneid} vs {zone_id}, {campaignid} vs {campaign_id}). Copy tokens from the list under the Target URL field in the campaign editor — that list is specific to your ad format and is the only authoritative one.",
      "If a tracker cannot handle ${SUBID}, PropellerAds documents these equivalents for the same value: {SUBID}, {CLICKID}, {click_id}, {clickid}, {CLICK_ID}, ${subid}, _~click_id~_.",

      "Response semantics, confirmed by probing the live endpoint on 2026-08-29: an unknown or empty click id is rejected with HTTP 400 and an empty body, and an accepted conversion returns HTTP 200 with the body \"1:0\". So unlike AdMaven or PopAds, a non-2xx here is a real signal worth acting on — a failed delivery usually means the click id never reached us intact. The success body is still not officially documented, which is why no success pattern is set: one observed sample is not enough to reject a 200 on.",
      "Conversions are accepted immediately but surface in PropellerAds' own reporting on a lag — roughly ten minutes in our test — so a delivery marked sent with nothing yet visible in their dashboard is normal.",
      "They de-duplicate on the click id: two accepted postbacks for the same visitor_id, sent minutes apart with different payouts, produced exactly ONE registered conversion. Good news for retries, which therefore cannot inflate their numbers. The flip side is that a genuine second purchase from the same click — a renewal, or an upgrade — will most likely not be counted twice, so do not expect repeat revenue from one click to show up as two conversions.",
    ],
  },
  {
    slug: "richads",
    name: "RichAds",
    site: "my.richads.com",
    docsUrl: "https://support.richads.com/article/3865",
    kind: "Push, in-page push, pops, native, direct click",
    landingUrlField: "Campaigns → your campaign → Destination URL (macro list is in Campaign Setup, Creatives section)",
    macros: [
      { ourParam: "cid", macro: "[CLICK_ID]", meaning: "The click id. Square brackets, uppercase.", required: true },
      { ourParam: "zone", macro: "[SITE_ID]", meaning: "Website id — swap for [ZONE_ID] on RichPops campaigns." },
      { ourParam: "camp", macro: "[CAMPAIGN_ID]", meaning: "RichAds campaign id." },
      { ourParam: "cre", macro: "[CREATIVE_ID]", meaning: "Creative id." },
      { ourParam: "cost", macro: "[BID_PRICE]", meaning: "What you paid for the click — [CPV_PRICE] on RichPops. This is COST, never conversion value." },
    ],
    postbackTemplate:
      "https://HOST-FROM-YOUR-RICHADS-DASHBOARD/log?action={{goal}}&key={{click_id}}&price={{payout}}",
    method: "GET",
    dashboardPath:
      'my.richads.com → Tracking tab (Tracking Wizard) → pick the conversion type → pick a tracker; the same URL also appears in campaign settings under the creatives block',
    // Not "account-specific": there is genuinely no account id in a RichAds
    // postback. What varies is the HOST, so this needs checking, not copying.
    templateConfidence: "verify",
    confidenceNote:
      "The path and parameters are account-agnostic and well corroborated, but public sources disagree on the HOST: RichAds' own docs show us.ahows.co while the RichAds templates shipped inside BeMob and FunnelFlux show xml.auxml.com. Both are live and resolve to the same servers — use whichever your dashboard gives you.",
    credentialNote:
      "None. There is no account id or key in the URL at all — the click id alone attributes the conversion, so anyone holding one could forge a conversion. Never expose a click id in client-side code.",
    failurePattern: "Required url parameters are not present",
    supportsPayout: true,
    payoutNote:
      "Parameter is price, and it is optional — RichAds says you may drop it if you do not want to disclose revenue. No currency parameter exists and the unit is not documented; confirm with RichAds and convert before sending.",
    supportsGoal: true,
    goalRequired: true,
    defaultGoals: { purchase: "conversion" },
    caveats: [
      'action carries the goal. RichAds documents action=conversion ("Main conversion") and action=conversion1 ("Approved conversion"); FunnelFlux additionally documents "lead". Take the value from the URL your own dashboard generates.',
      "This template uses {{goal}} for the action, so any event you enable MUST have a goal value — with an empty one the parameter is dropped and the call is rejected.",
      "The endpoint answers HTTP 200 even when it rejects the call, with the body \"Required url parameters are not present\". The failure-pattern field below is prefilled with that text so such a delivery is recorded as failed instead of sent.",
      "RichPush and RichPops have different macro sets: Push has [SUB_LIST_ID] and [BID_PRICE]; Pops has [ZONE_ID] and [CPV_PRICE].",
      "Third-party macro lists for RichAds are known to go stale. The in-dashboard list and support.richads.com/article/3865 are the authoritative ones.",
      "Send over https even if the URL you copy starts with http:// — it carries your click id and your revenue figure.",
    ],
  },
  {
    slug: "evadav",
    name: "EvaDav",
    site: "evadav.com",
    docsUrl: "https://support.evadav.com/en/articles/7048910-macros-in-target-url",
    kind: "Push, in-page push, pop, native, VAST video",
    landingUrlField: "Campaign → Target URL (full macro list at Advertiser → Tracking)",
    macros: [
      { ourParam: "cid", macro: "{CLICKID}", meaning: "The click id. Single curly braces, uppercase.", required: true },
      { ourParam: "zone", macro: "{ZONE_ID}", meaning: "Zone / common source id. {SOURCE_ID} is the finer-grained one." },
      { ourParam: "camp", macro: "{CAMPAIGN_ID}", meaning: "EvaDav campaign id." },
      { ourParam: "cre", macro: "{CREATIVE_ID}", meaning: "Creative id." },
      { ourParam: "cost", macro: "{COST}", meaning: "Cost token. EvaDav's table labels it 'Conversion payout'; treat the meaning as unconfirmed." },
    ],
    postbackTemplate: "https://evadav.com/phpb?click_id={{click_id}}&payout={{payout}}",
    method: "GET",
    dashboardPath:
      "Advertiser account → Tracking (evadav.com/advertiser/tracking) — macro list plus a test Click ID generator; also check the campaign's own S2S postback field",
    templateConfidence: "confirmed",
    confidenceNote:
      "A genuinely universal endpoint: the same host and path appear in EvaDav's own blog and in three independent tracker integrations, and it responds live. Still compare it against what your dashboard shows before you spend.",
    credentialNote:
      "None — the endpoint is unauthenticated and validates only the click id. Fire it server-side only.",
    failurePattern: '"status":"error"',
    supportsPayout: true,
    payoutNote:
      "Parameter is payout, a plain decimal. No currency parameter exists; advertiser accounts are USD, so convert from INR before sending.",
    supportsGoal: false,
    caveats: [
      'The endpoint returns HTTP 200 even when it fails, with a JSON body such as {"status":"error","message":"Incorrect click_id value"}. The failure-pattern field is prefilled with "status":"error" so those are recorded as failed.',
      "GET only. A form-encoded POST is rejected with HTTP 400 by EvaDav's CSRF layer.",
      "EvaDav supports two goals per campaign (reported as Leads1 / Leads2), but the parameter that distinguishes them is not published anywhere. Do not invent one — configure the goals in campaign settings and paste the goal-specific URL EvaDav generates.",
      "Use the test Click ID generator on the Tracking page before spending. EvaDav's own docs call an incorrect token the most common advertiser error.",
      "The endpoint sits behind Cloudflare and can return transient 5xx — retries are automatic here.",
    ],
  },
  {
    slug: "admaven",
    name: "AdMaven",
    site: "ad-maven.com",
    docsUrl: "https://help.ad-maven.com/",
    kind: "Popunder, push, interstitial, in-page",
    landingUrlField: "Campaign → Destination / Target URL",
    macros: [
      { ourParam: "cid", macro: "{:click_id}", meaning: "The click id — note the COLON inside the braces. A long numeric string; keep it as text.", required: true },
      { ourParam: "zone", macro: "{:source_id}", meaning: "Traffic source / placement id. {:sub_source_id} is finer-grained." },
      { ourParam: "camp", macro: "{:campaign_id}", meaning: "AdMaven campaign id." },
      { ourParam: "cre", macro: "{:creative_id}", meaning: "Creative id." },
      { ourParam: "cost", macro: "{:cost}", meaning: "Cost of this click or view (not CPM)." },
    ],
    postbackTemplate:
      "https://pixel-maven.com/pixel?info=YOUR_ADMAVEN_KEY&unique_req={{click_id}}&value={{payout}}",
    method: "GET",
    dashboardPath:
      'Advertiser panel → Profile icon → Profile → "Tracking URL" → pick your tracker, or "Other" → copy the ready-made postback',
    templateConfidence: "account-specific",
    confidenceNote:
      "AdMaven deliberately does not publish a universal template — theirs is generated per account and contains your key. This prefill is reconstructed from ONE tracker's integration guide (BeMob), so treat it as a cross-check and copy the real string from your panel.",
    credentialNote:
      "info= carries your AdMaven advertiser key. It is the credential; keep it server-side and never in browser code.",
    supportsPayout: true,
    payoutNote:
      "Parameter is value, and AdMaven reports in US Dollars — this one IS documented. Convert INR to USD before sending: a raw ₹499 would be read as $499 and wreck their optimiser.",
    supportsGoal: false,
    caveats: [
      "Three URL generations are in circulation. Only pixel-maven.com/pixel (info / unique_req / value) is current. xml.ad-maven.com/conversion and xml.realtime-bid.com/conversion use different parameter names (c / count / value), and pop.rtb-passthrough.com does not resolve at all — a postback sent there fails silently for ever.",
      "The endpoint returns HTTP 200 with a 1×1 GIF no matter what you send it, including a bogus key. A 200 here proves nothing — confirm the conversion and its Goals value in AdMaven's own reports.",
      "The click-id macro spelling is not settled: AdMaven's macro reference and Voluum use {:click_id}, but a second AdMaven article writes {click_id} and older PeerClick material uses [click_id]. Run one real test click and check the value arrives substituted.",
      "Keep https — a plain http:// URL may redirect and drop the call.",
      "AdMaven has no goal or event parameter: one undifferentiated conversion stream. Express plan differences through the payout value instead.",
    ],
  },
  {
    slug: "popads",
    name: "PopAds",
    site: "popads.net",
    kind: "Popunder",
    landingUrlField: "Campaign → Target URL (the 'Send details' token list)",
    macros: [
      { ourParam: "cid", macro: "[IMPRESSIONID]", meaning: "The click id. Square brackets, uppercase. Retained by PopAds for only 48 hours.", required: true },
      { ourParam: "zone", macro: "[WEBSITEID]", meaning: "Publisher website id — the dimension you blacklist on." },
      { ourParam: "camp", macro: "[CAMPAIGNID]", meaning: "PopAds campaign id." },
      { ourParam: "cost", macro: "[BID]", meaning: "Price paid for the impression." },
    ],
    postbackTemplate:
      "https://serve.popads.net/cpixel.php?s2s=1&aid=YOUR_AID&id={{click_id}}&value={{payout}}",
    method: "GET",
    dashboardPath:
      "Campaigns → Campaign Info → Conversions section → Pixels and Postback → Conversion Tracking → Postback",
    templateConfidence: "account-specific",
    confidenceNote:
      "PopAds' advertiser knowledge base sits behind a member login, so this prefill is reconstructed from several independent tracker integrations that all agree. The dashboard URL is authoritative and already contains your aid.",
    credentialNote:
      "aid= is your PopAds identifier and the only thing authenticating the call. It cannot be derived — copy it from the dashboard and keep it server-side.",
    supportsPayout: true,
    payoutNote:
      "Parameter is value, in US Dollars only, with a dot separator and no symbol. There is no currency parameter — convert from INR yourself.",
    supportsGoal: false,
    caveats: [
      "48-HOUR WINDOW: PopAds does not retain impression ids beyond 48 hours after the click, so a later postback is discarded. For a subscription funnel, report an event that happens inside that window.",
      "The URL PopAds shows you contains the literal words impressionId and conversionValue — replace those two with {{click_id}} and {{payout}} and change nothing else.",
      "Every guide prints http://; serve.popads.net serves a valid certificate, so use https and keep your aid out of cleartext.",
      "No goal or event parameter is documented. Pick the single event you want PopAds' optimiser to learn from.",
      "Sources disagree on whether the postback URL is per-account or per-campaign. Copying it fresh from each campaign's Conversion Tracking screen is correct either way.",
      "The response body is undocumented — do not parse it. Confirm the first live conversions in the PopAds campaign report.",
    ],
  },
  {
    slug: "popcash",
    name: "PopCash",
    site: "popcash.net",
    kind: "Popunder",
    landingUrlField: "Campaigns → your campaign → Edit → Target URL",
    macros: [
      { ourParam: "cid", macro: "[clickid]", meaning: "The click id. Square brackets, LOWERCASE. PopCash also appends it as pid=[clickid] by default.", required: true },
      { ourParam: "zone", macro: "[siteid]", meaning: "Publisher site id — the main optimisation dimension for pop traffic." },
      { ourParam: "camp", macro: "[campaignid]", meaning: "PopCash campaign id." },
      { ourParam: "cost", macro: "[bid]", meaning: "Visit cost — the price paid for that impression." },
    ],
    postbackTemplate:
      "https://ct.popcash.net/click?aid=YOUR_AID&clickid={{click_id}}&payout={{payout}}",
    method: "GET",
    dashboardPath:
      "Conversion Tracker in the left menu (the same URL also appears under Campaigns → your campaign → Edit) → Copy URL",
    templateConfidence: "account-specific",
    confidenceNote:
      'PopCash issues the URL per account — "Each user has a unique aid, so please use the one corresponding to your account". This prefill only shows the shape published by PopCash-integrated trackers.',
    credentialNote:
      "aid= is your PopCash account id and the only thing identifying the call. Treat the whole URL as a secret.",
    supportsPayout: true,
    payoutNote:
      "Parameter is payout, a plain decimal. Currency handling is entirely undocumented — send USD and check the revenue PopCash reports for your first real conversion before trusting ROI.",
    supportsGoal: false,
    caveats: [
      "The path is literally /click even though it registers a conversion. That is not a typo — it is consistent across every independent source.",
      "PopCash delivers the click id as pid= on your target URL by default. Set the Target URL from the template below so it also arrives as our cid= parameter, which is what we capture.",
      "This endpoint DOES signal rejection: it answers HTTP 400 with an empty body. A failed delivery here is real — check the aid and the click id.",
      "PopCash supports two conversion actions per visitor, but whether the second is a separate URL or a parameter is not published. Do not invent a goal parameter — copy the second URL from the Conversion Tracker if it offers one.",
      "Never ship an example aid from a guide; conversions sent with someone else's placeholder are rejected.",
      "Tokens like {!tscode!} and {!revenue!} in published examples belong to third-party trackers, not to PopCash. Replace them with {{click_id}} and {{payout}}.",
    ],
  },
  {
    slug: "hilltopads",
    name: "HilltopAds",
    site: "user.hilltopads.com",
    docsUrl: "https://hilltopads.com/",
    kind: "Popunder, in-page push, video (VAST), banner",
    landingUrlField: "Manage Campaigns → your campaign → Final Destination URL",
    macros: [
      { ourParam: "cid", macro: "{{ctoken}}", meaning: "The click id. DOUBLE curly braces. Echoed back as the token= parameter.", required: true },
      { ourParam: "zone", macro: "{{zoneid}}", meaning: "Traffic source / ad zone id — HilltopAds is blind, so you get ids, not site names." },
      { ourParam: "camp", macro: "{{campaignid}}", meaning: "HilltopAds campaign id." },
      { ourParam: "cre", macro: "{{adid}}", meaning: "Ad / creative id." },
      { ourParam: "cost", macro: "{{price}}", meaning: "YOUR media cost for the impression or click — not the conversion value." },
    ],
    postbackTemplate:
      "https://trackhta.com/close/?token={{click_id}}&price={{payout}}&currency={{currency}}&goal={{goal}}&advertiserid=YOUR_ADVERTISER_ID",
    method: "GET",
    dashboardPath:
      "User panel → Trackers (user.hilltopads.com/advertiser/trackers) → copy your unique Postback URL and your Advertiser ID; the same screen has a Test Conversion tool",
    templateConfidence: "account-specific",
    confidenceNote:
      "The shape comes from HilltopAds' own goals article, but the URL is issued per account. Their newest articles use trackhta.com while tracker guides still publish postback.hilltopads.com — both resolve to the same address, but neither has been declared interchangeable, so use the host your dashboard gives you.",
    credentialNote:
      "advertiserid= is your HilltopAds Advertiser ID, copied from the Trackers screen.",
    supportsPayout: true,
    payoutNote:
      "Parameter is price (the conversion revenue) with currency alongside it. USD is the platform's native currency — send USD-normalised amounts unless your dashboard says otherwise.",
    supportsGoal: true,
    defaultGoals: { registration: "reg" },
    caveats: [
      "COPY, NEVER RETYPE the advertiser-ID parameter. HilltopAds' own docs spell it three ways — advertiserid, advertiserId and advertiserID — and which one the endpoint accepts could not be determined.",
      "NAMING TRAP: {{price}} on the LANDING URL is your media cost, while price on the POSTBACK is the conversion revenue. Never wire one into the other.",
      "MACRO CLASH: HilltopAds' own macros use double curly braces, the same syntax as this panel's. If you paste their example postback verbatim, its {{currency}} happens to match one of ours, but {{price}} does not — and the engine refuses to send a URL containing an unresolved macro, so every postback would fail until you replace it with {{payout}}. Unrecognised macros are listed on the delivery row.",
      "The main billing conversion carries price and currency and NO goal. Secondary events carry goal=<name> (their example is goal=reg) and no price — set those events' payout mode to 'Do not send' and both parameters drop out automatically.",
      "Ignore the label parameter that appears in their JavaScript snippet; it is undocumented and goal does the same job.",
      "No success response is documented — verify with Trackers → Test Conversion and in HilltopAds reporting, not by HTTP status.",
    ],
  },
];

export function findNetwork(slug: string): AdNetworkDef | undefined {
  return AD_NETWORKS.find((n) => n.slug === slug);
}

export const CONFIDENCE_LABEL: Record<Confidence, { label: string; blurb: string; tone: string }> = {
  confirmed: {
    label: "Universal endpoint",
    blurb:
      "One endpoint for every advertiser, published by the network itself. Still worth comparing against your dashboard.",
    tone: "success",
  },
  verify: {
    label: "Confirm the URL in your dashboard",
    blurb:
      "The parameters are documented and stable, but part of the URL — the host, or a detail that has changed over time — is not something to hard-code. Check it against what your dashboard shows before this carries real spend.",
    tone: "warning",
  },
  "account-specific": {
    label: "Copy yours from the dashboard",
    blurb:
      "This network generates a postback URL containing ids unique to your account. The prefill below only shows the shape — paste in the real one.",
    tone: "warning",
  },
};
