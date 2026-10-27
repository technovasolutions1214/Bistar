/**
 * What this device remembers about a guest checkout.
 *
 * WHY THIS EXISTS: a guest types their phone, we sign them in anonymously and
 * open PayU. From then on the navbar shows an account and the visitor counts
 * themselves signed in — but nothing kept the number, so every return to the
 * home page (a reload, the browser coming back from a UPI app, a closed
 * payment window) showed the empty phone box again, and a buyer who had just
 * paid lost the "Sign in to activate" step with it.
 *
 * So we keep the normalized phone, the anonymous uid it was entered under,
 * and the transactions started with it. While that same anonymous session is
 * signed in — and only for MEMORY_TTL_MS after the last checkout — this lets
 * us prefill the number, treat the guest like a signed-in visitor without a
 * subscription (paywall, not the phone box), and pick a payment back up on
 * /plans. It is forgotten once a real account signs in, or on sign-out.
 *
 * Device-local and UI-only: nothing trusts it. The server's record of the
 * guest is pendingClaims, released only to the OTP-verified number. Every
 * storage access is wrapped — private windows and blocked storage throw.
 */

const KEY = "bistar.guestCheckout";

/**
 * How long a checkout is remembered. The anonymous session itself never
 * expires, so without this an abandoned guest checkout on a shared device
 * would hand the next person that number — and a purchase made against it
 * could only ever be claimed by its owner. A few hours covers coming back to
 * the same visit (a UPI app, a reload, a closed window).
 */
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;

/** Recent transactions kept for naming the number a payment was made with. */
const MAX_REMEMBERED_TXNS = 10;

export interface GuestCheckout {
  /** E.164, exactly as sent to guest-init (normalizePhone output). */
  phone: string;
  /** The anonymous session the phone was entered under. */
  uid: string;
  /** The last transaction started under that session. */
  txnid?: string;
  /** When that transaction was started (ms since epoch). */
  startedAt?: number;
  /**
   * The phone each recent transaction of this session was made with. A guest
   * can retry with a different number, and whichever payment lands is only
   * claimable by ITS number.
   */
  phones?: Record<string, string>;
}

export function readGuestCheckout(): GuestCheckout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Partial<GuestCheckout>;
    if (typeof g.phone !== "string" || typeof g.uid !== "string") return null;
    const phones: Record<string, string> = {};
    if (g.phones && typeof g.phones === "object") {
      for (const [t, p] of Object.entries(g.phones)) if (typeof p === "string") phones[t] = p;
    }
    return {
      phone: g.phone,
      uid: g.uid,
      txnid: typeof g.txnid === "string" ? g.txnid : undefined,
      startedAt: typeof g.startedAt === "number" ? g.startedAt : undefined,
      phones,
    };
  } catch {
    return null;
  }
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
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...g, phones: Object.fromEntries(phones) }));
  } catch {
    /* storage unavailable — the guest just types the number again */
  }
}

/**
 * `g` if it belongs to the session signed in now and is still fresh. Prefill,
 * the paywall redirect and the resume banner only ever go through this: on a
 * shared device the next person must not be handed someone else's number.
 */
export function rememberedFor(
  g: GuestCheckout | null,
  user: { uid: string; isAnonymous: boolean } | null | undefined,
): GuestCheckout | null {
  if (!g || !user?.isAnonymous || g.uid !== user.uid) return null;
  if (g.startedAt === undefined || Date.now() - g.startedAt > MEMORY_TTL_MS) return null;
  return g;
}

/** The remembered checkout for the session signed in now, if still fresh. */
export function guestCheckoutFor(
  user: { uid: string; isAnonymous: boolean } | null | undefined,
): GuestCheckout | null {
  return rememberedFor(readGuestCheckout(), user);
}

/** Forget the guest checkout — once a real account signs in, or on sign-out. */
export function clearGuestCheckout(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
