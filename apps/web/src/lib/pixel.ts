// Meta Pixel helper. Calls are no-ops when window.fbq is not defined, which
// happens whenever no pixel is configured in the marketing panel — see
// PixelLoader for the gating logic.
//
// Every event also goes through a diagnostics tap (see `report` below), which is
// what makes a newly added pixel verifiable: the Pixels panel shows the events
// that actually fired, and `?pixelDebug=1` shows them on the page itself. The
// tap is strictly observational — it runs AFTER fbq and can never change
// whether the real event was sent.

type FbqArgs =
  | ["init", string]
  | ["track", string, Record<string, unknown>?, { eventID?: string }?]
  | ["trackCustom", string, Record<string, unknown>?]
  | ["consent", "grant" | "revoke"];

type Fbq = ((...args: FbqArgs) => void) & { queue?: unknown[]; loaded?: boolean };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

function fbqOrNull(): Fbq | null {
  if (typeof window === "undefined") return null;
  return typeof window.fbq === "function" ? window.fbq : null;
}

export function isPixelEnabled(): boolean {
  return fbqOrNull() !== null;
}

/* ------------------------------------------------------------ diagnostics --- */

export interface PixelDebugEntry {
  event: string;
  params?: Record<string, unknown>;
  eventID?: string;
  at: number;
  /** False when fbq was absent, i.e. the call was dropped on the floor. */
  sent: boolean;
}

interface Diagnostics {
  slug?: string;
  pixelId?: string;
  /** Mirror the panel's verify window: only then do we beacon to the server. */
  verify: boolean;
  /** `?pixelDebug=1` — render the on-page overlay. Costs nothing server-side. */
  overlay: boolean;
}

let diag: Diagnostics = { verify: false, overlay: false };

/** Last few events, newest last. Bounded — this is a debug aid, not a buffer. */
const recent: PixelDebugEntry[] = [];
const MAX_RECENT = 50;
const listeners = new Set<(entries: PixelDebugEntry[]) => void>();

/** Called once by PixelLoader as soon as it knows which pixel it resolved. */
export function configurePixelDiagnostics(next: Partial<Diagnostics>): void {
  diag = { ...diag, ...next };
}

export function pixelDebugEnabled(): boolean {
  return diag.overlay;
}

/** Subscribe to the debug feed. Returns an unsubscribe. */
export function onPixelDebug(fn: (entries: PixelDebugEntry[]) => void): () => void {
  listeners.add(fn);
  fn([...recent]);
  return () => listeners.delete(fn);
}

/**
 * Record an event for the diagnostics feed, and — only while the panel's verify
 * window is open — beacon it to the server so the Pixels panel can show it.
 *
 * Never throws and is never awaited. The real fbq call has already happened.
 */
function report(entry: PixelDebugEntry): void {
  recent.push(entry);
  if (recent.length > MAX_RECENT) recent.shift();
  if (listeners.size) {
    const snapshot = [...recent];
    listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch {
        /* a debug listener must not break tracking */
      }
    });
  }

  if (!diag.verify || !diag.slug || typeof window === "undefined") return;
  try {
    const value = entry.params?.value;
    const body = JSON.stringify({
      slug: diag.slug,
      pixelId: diag.pixelId,
      event: entry.event,
      eventId: entry.eventID,
      path: window.location.pathname,
      // Key names only — never the values, which can carry a search string or
      // other user input we have no business storing for a debug feed.
      paramKeys: entry.params ? Object.keys(entry.params) : [],
      value: typeof value === "number" ? value : undefined,
    });
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(
        "/api/track/pixel-event",
        new Blob([body], { type: "application/json" })
      );
      if (ok) return;
    }
    void fetch("/api/track/pixel-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never let diagnostics break the page */
  }
}

/* ------------------------------------------------------------------ track --- */

export function track(
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
): void {
  const fbq = fbqOrNull();
  // eventID lets a browser event dedupe against the server-side CAPI event.
  if (fbq) {
    if (params && options) fbq("track", event, params, options);
    else if (params) fbq("track", event, params);
    else fbq("track", event);
  }
  // Reported either way: "the pixel never loaded" is the single most useful
  // thing a debug feed can tell you, and it is invisible if we bail early.
  report({ event, params, eventID: options?.eventID, at: Date.now(), sent: !!fbq });
}

export function trackCustom(event: string, params?: Record<string, unknown>): void {
  const fbq = fbqOrNull();
  if (fbq) {
    if (params) fbq("trackCustom", event, params);
    else fbq("trackCustom", event);
  }
  report({ event, params, at: Date.now(), sent: !!fbq });
}
