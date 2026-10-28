/**
 * What this device remembers about a guest checkout.
 *
 * WHY THIS EXISTS: a guest types their phone once, on the home page. From
 * there the plans page shows that number at the top, the payment window uses
 * it as its header and pays against it, and every return to the site (a
 * reload, the browser coming back from a UPI app, a closed payment window)
 * picks it up again instead of showing an empty phone box.
 *
 * So we keep the normalized phone, the anonymous session it is paying under
 * (none until the first checkout starts — typing a number creates no account),
 * and the transactions started with it. Only for MEMORY_TTL_MS after it was
 * last saved, and only while that same session (or no session) is signed in,
 * does this prefill the number, send the visitor from home to /plans, and pick
 * a payment back up there. It is forgotten once a real account signs in, or on
 * sign-out.
 *
 * Device-local and UI-only: nothing trusts it. The server's record of what a
 * guest paid for is pendingClaims, released only to the OTP-verified number.
 * Every storage access is wrapped — private windows and blocked storage throw —
 * and a copy is kept in memory, so with storage blocked the number still
 * reaches the plans page from the home box.
 */

const KEY = "bistar.guestCheckout";

/** This page's copy, used only once storage has failed. */
let inMemory: GuestCheckout | null = null;
let storageBroken = false;

/** Whether this browser keeps what we store (a blocked one forgets on reload). */
export function deviceStorageWorks(): boolean {
  return !storageBroken;
}

/**
 * How long a number is remembered. Anonymous sessions never expire, so
 * without this an abandoned guest checkout on a shared device would hand the
 * next person that number — and a purchase made against it could only ever
 * be claimed by its owner. A few hours covers coming back to the same visit
 * (a UPI app, a reload, a closed window).
 */
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;

/** Recent transactions kept for naming the number a payment was made with. */
const MAX_REMEMBERED_TXNS = 10;

export interface GuestCheckout {
  /** E.164, exactly as sent to guest-init (normalizePhone output). */
  phone: string;
  /** The anonymous session paying with it; absent until a checkout starts. */
  uid?: string;
  /** When the number was last saved (ms since epoch) — drives the TTL. */
  savedAt?: number;
  /** The last transaction started under that session. */
  txnid?: string;
  /** When that transaction was started (ms since epoch). */
  startedAt?: number;
  /**
   * The phone each recent transaction of this session was made with. A guest
   * can change the number between checkouts, and whichever payment lands is
   * only claimable by ITS number.
   */
  phones?: Record<string, string>;
}

export function readGuestCheckout(): GuestCheckout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    // With storage working, a missing key means forgotten (perhaps by
    // another tab's sign-out), so never fall back to this page's copy.
    if (!raw) return storageBroken ? inMemory : null;
    const g = JSON.parse(raw) as Partial<GuestCheckout>;
    if (typeof g.phone !== "string") return null;
    const phones: Record<string, string> = {};
    if (g.phones && typeof g.phones === "object") {
      for (const [t, p] of Object.entries(g.phones)) if (typeof p === "string") phones[t] = p;
    }
    return {
      phone: g.phone,
      uid: typeof g.uid === "string" ? g.uid : undefined,
      savedAt: typeof g.savedAt === "number" ? g.savedAt : undefined,
      txnid: typeof g.txnid === "string" ? g.txnid : undefined,
      startedAt: typeof g.startedAt === "number" ? g.startedAt : undefined,
      phones,
    };
  } catch {
    storageBroken = true;
    return inMemory;
  }
}

function write(g: GuestCheckout): void {
  inMemory = g;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    storageBroken = true;
    /* storage unavailable — this page keeps its copy until it reloads */
  }
}

/**
 * Remember the number a guest typed (home box, the plans-page bar, the payment
 * window), before any checkout. `uid` is the anonymous session already signed
 * in, if there is one. The last checkout's details survive only when it was
 * made under that same session, so the plans page can still pick it up.
 */
export function rememberGuestPhone(phone: string, uid?: string): void {
  const prev = readGuestCheckout();
  const sameSession = !!prev?.uid && prev.uid === uid;
  write({
    phone,
    uid,
    savedAt: Date.now(),
    ...(sameSession ? { txnid: prev.txnid, startedAt: prev.startedAt, phones: prev.phones } : {}),
  });
}

/** Record a guest checkout once guest-init has linked the phone to the txn. */
export function rememberGuestCheckout(g: {
  phone: string;
  uid: string;
  txnid: string;
  startedAt: number;
}): void {
  const prev = readGuestCheckout();
  const phones = Object.entries({
    ...(prev?.uid === g.uid ? prev.phones : {}),
    [g.txnid]: g.phone,
  }).slice(-MAX_REMEMBERED_TXNS);
  write({ ...g, savedAt: g.startedAt, phones: Object.fromEntries(phones) });
}

/**
 * A remembered checkout has been seen through — paid and acknowledged — so
 * the plans page must not pick it up again (it would announce the payment and
 * take the buyer to the titles on every visit while it's recent).
 */
export function settleGuestCheckout(txnid: string): void {
  const prev = readGuestCheckout();
  if (!prev || prev.txnid !== txnid) return;
  write({ ...prev, txnid: undefined, startedAt: undefined });
}

/**
 * `g` if it belongs to whoever is signed in now and is still fresh: nobody
 * signed in and the number not yet tied to a session, or the anonymous session
 * it was tied to (or one it can be tied to). Prefill, the home → /plans
 * redirect and the plans-page number all go through this: on a shared device
 * the next person must not be handed someone else's number.
 */
export function rememberedFor(
  g: GuestCheckout | null,
  user: { uid: string; isAnonymous: boolean } | null | undefined,
): GuestCheckout | null {
  if (!g) return null;
  const savedAt = g.savedAt ?? g.startedAt;
  if (savedAt === undefined || Date.now() - savedAt > MEMORY_TTL_MS) return null;
  if (!user) return g.uid ? null : g;
  if (!user.isAnonymous) return null;
  if (g.uid && g.uid !== user.uid) return null;
  return g;
}

/** The remembered checkout for whoever is signed in now, if still fresh. */
export function guestCheckoutFor(
  user: { uid: string; isAnonymous: boolean } | null | undefined,
): GuestCheckout | null {
  return rememberedFor(readGuestCheckout(), user);
}

/** Forget the guest checkout — once a real account signs in, or on sign-out. */
export function clearGuestCheckout(): void {
  inMemory = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
