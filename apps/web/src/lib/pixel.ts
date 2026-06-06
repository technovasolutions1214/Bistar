// Meta Pixel helper. Calls are no-ops when window.fbq is not defined, which
// happens whenever the admin has left the Meta Pixel ID blank in
// settings/general — see PixelLoader for the gating logic.

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

export function track(
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
): void {
  const fbq = fbqOrNull();
  if (!fbq) return;
  // eventID lets a browser event dedupe against the server-side CAPI event.
  if (params && options) fbq("track", event, params, options);
  else if (params) fbq("track", event, params);
  else fbq("track", event);
}

export function trackCustom(event: string, params?: Record<string, unknown>): void {
  const fbq = fbqOrNull();
  if (!fbq) return;
  if (params) fbq("trackCustom", event, params);
  else fbq("trackCustom", event);
}
