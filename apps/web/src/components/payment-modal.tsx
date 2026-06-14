"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signInAnonymously } from "firebase/auth";
import { auth } from "@bistar/firebase-config";
import { Button, Input } from "@bistar/ui";
import type { Plan } from "@bistar/shared";
import { useAuth } from "@/lib/auth-context";
import { track } from "@/lib/pixel";
import { getAttribution } from "@/lib/attribution";

type ModalStatus =
  | "collect" // guest: entering phone before payment
  | "opening" // creating the transaction
  | "waiting" // PayU iframe shown, polling
  | "success" // signed-in user: subscription active
  | "claim" // guest: paid, must sign in to activate
  | "failed"
  | "timeout"
  | "error";

interface PaymentModalProps {
  open: boolean;
  plan: Plan | null;
  onClose: () => void;
  onSuccess?: () => void;
}

// Poll the transaction doc — updated by the PayU S2S webhook at
// /api/payment/payu/webhook — every few seconds while the iframe is open.
const POLL_INTERVAL_MS = 3000;

// Enough headroom for 3-D Secure / bank OTP. If the webhook never arrives
// within this window we surface a timeout instead of polling forever.
const MAX_POLL_DURATION_MS = 20 * 60 * 1000;

const COUNTRY_CODES = ["+91", "+1", "+44", "+61", "+971"];

// iOS Safari (and iPadOS, which reports as "Macintosh" but is touch-capable)
// refuses to launch a native app from a custom URL scheme (upi://, gpay://,
// phonepe://, paytm://) when that navigation originates inside a cross-origin
// iframe — the scheme only fires from a TOP-LEVEL browsing context under a user
// gesture. So on iOS we run PayU in a real browser tab instead of the iframe.
// Android (intent://) and desktop are unaffected and keep the inline iframe.
function isIOS(): boolean {
  if (typeof navigator === "undefined" || typeof document === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
}

export function PaymentModal({ open, plan, onClose, onSuccess }: PaymentModalProps) {
  const { firebaseUser } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<ModalStatus>("opening");
  const [message, setMessage] = useState("");
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [txnId, setTxnId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loginFallback, setLoginFallback] = useState(false);

  // Guest phone entry
  const [countryCode, setCountryCode] = useState("+91");
  const [phone, setPhone] = useState("");

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number>(0);
  const resolvedRef = useRef(false);
  const isGuestRef = useRef(false);
  const claimPhoneRef = useRef("");
  // iOS-only: the PayU tab we open synchronously on the user's tap, and the last
  // paymentUrl (so "Reopen payment tab" is a fresh user gesture).
  const payWindowRef = useRef<Window | null>(null);
  const lastPayUrlRef = useRef<string | null>(null);

  // A "real" user is signed in and NOT anonymous. Anonymous = mid guest checkout.
  const realUser = !!firebaseUser && !firebaseUser.isAnonymous;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  // Point the pre-opened iOS tab at PayU. If it was blocked or the user closed
  // it, fall back to a same-tab top-level navigation (still launches UPI on iOS
  // because it's top-level; only ever called from inside a user gesture).
  const sendToPayU = useCallback((url: string) => {
    lastPayUrlRef.current = url;
    const w = payWindowRef.current;
    if (w && !w.closed) {
      try {
        w.location.href = url;
        return;
      } catch {
        // cross-origin/blocked handle — fall through to same-tab
      }
    }
    window.location.assign(url);
  }, []);

  const closePayWindow = useCallback(() => {
    if (payWindowRef.current && !payWindowRef.current.closed) {
      try {
        payWindowRef.current.close();
      } catch {
        /* ignore */
      }
    }
    payWindowRef.current = null;
  }, []);

  // Reset everything whenever the modal reopens.
  useEffect(() => {
    if (!open) return;
    setMessage("");
    setError("");
    setPaymentUrl(null);
    setTxnId(null);
    setLoginFallback(false);
    setPhone("");
    payWindowRef.current = null;
    lastPayUrlRef.current = null;
    resolvedRef.current = false;
    startedAtRef.current = Date.now();
    // Signed-in users go straight to checkout; guests collect a phone first.
    isGuestRef.current = !realUser;
    setStatus(realUser ? "opening" : "collect");
  }, [open, realUser]);

  useEffect(() => {
    if (!open) stopPolling();
    return () => stopPolling();
  }, [open, stopPolling]);

  const finish = useCallback(
    (next: ModalStatus, msg: string) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      stopPolling();
      setStatus(next);
      setMessage(msg);
    },
    [stopPolling],
  );

  const pollOnce = useCallback(
    async (id: string) => {
      if (resolvedRef.current) return;
      const u = auth().currentUser;
      if (!u) return;
      if (Date.now() - startedAtRef.current > MAX_POLL_DURATION_MS) {
        finish(
          "timeout",
          "We didn't see a payment confirmation in time. If you were charged, contact support.",
        );
        return;
      }
      try {
        const token = await u.getIdToken();
        const res = await fetch(`/api/payment/status?txnId=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!res.ok) {
          pollTimerRef.current = setTimeout(() => pollOnce(id), POLL_INTERVAL_MS);
          return;
        }
        const body = (await res.json()) as {
          status: "pending" | "success" | "failed";
          amount?: number;
          currency?: string;
          planId?: string;
        };
        if (body.status === "success") {
          // iOS: drop the user back onto this (still-polling) tab by closing the
          // PayU tab we opened. Best-effort — browsers may refuse after the tab
          // navigated cross-origin.
          if (isIOS() && payWindowRef.current && !payWindowRef.current.closed) {
            try {
              payWindowRef.current.close();
            } catch {
              /* ignore */
            }
          }
          // Fire Purchase with eventID=txnid so it dedupes against the
          // server-side CAPI Purchase the webhook trigger sends.
          track(
            "Purchase",
            {
              content_ids: body.planId ? [body.planId] : undefined,
              value: typeof body.amount === "number" ? body.amount : undefined,
              currency: body.currency || "INR",
            },
            { eventID: id },
          );
          if (isGuestRef.current) {
            // Guest must sign in to bind the purchase to a real account.
            finish("claim", "");
          } else {
            finish("success", "Your subscription is now active.");
            onSuccess?.();
          }
          return;
        }
        if (body.status === "failed") {
          finish("failed", "Payment didn't go through. Please try again or contact support.");
          return;
        }
        pollTimerRef.current = setTimeout(() => pollOnce(id), POLL_INTERVAL_MS);
      } catch {
        pollTimerRef.current = setTimeout(() => pollOnce(id), POLL_INTERVAL_MS);
      }
    },
    [finish, onSuccess],
  );

  // Signed-in checkout: auto-start create once the modal opens for a real user.
  useEffect(() => {
    if (!open || !plan) return;
    if (status !== "opening" || isGuestRef.current) return;
    // iOS signed-in users start checkout from the "Pay now" tap — window.open
    // needs a user gesture, and this effect has none. Guests already tap.
    if (isIOS()) return;
    let cancelled = false;

    (async () => {
      try {
        const u = auth().currentUser;
        if (!u) {
          finish("error", "Please sign in again.");
          return;
        }
        const token = await u.getIdToken();
        const res = await fetch("/api/payment/payu/create", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ planId: plan.id }),
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.paymentUrl) {
          finish("error", body.error || "Couldn't start the payment. Please try again.");
          return;
        }
        recordAttribution(token, body.txnid);
        setPaymentUrl(body.paymentUrl);
        setTxnId(body.txnid);
        setStatus("waiting");
        pollTimerRef.current = setTimeout(() => pollOnce(body.txnid), POLL_INTERVAL_MS);
      } catch (err) {
        if (!cancelled) {
          finish("error", err instanceof Error ? err.message : "Couldn't start the payment.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, plan, status, finish, pollOnce]);

  // iOS signed-in checkout: triggered by the "Pay now" tap so window.open has a
  // user gesture. Mirrors the auto-create effect but renders PayU in a top-level
  // tab (opened synchronously here) instead of the iframe.
  const startSignedInCheckoutIOS = useCallback(async () => {
    if (!plan) return;
    // Open the tab synchronously (first thing in the gesture) so iOS doesn't
    // popup-block it; we point it at PayU once create() resolves.
    payWindowRef.current = window.open("about:blank", "_blank");
    try {
      payWindowRef.current?.document.write(
        '<title>Loading…</title><body style="font-family:-apple-system,sans-serif;padding:32px;color:#333">Loading secure payment…</body>',
      );
    } catch {
      /* ignore */
    }
    setStatus("opening");
    try {
      const u = auth().currentUser;
      if (!u) {
        closePayWindow();
        finish("error", "Please sign in again.");
        return;
      }
      const token = await u.getIdToken();
      const res = await fetch("/api/payment/payu/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planId: plan.id }),
      });
      const body = await res.json();
      if (!res.ok || !body.paymentUrl) {
        closePayWindow();
        finish("error", body.error || "Couldn't start the payment. Please try again.");
        return;
      }
      recordAttribution(token, body.txnid);
      setTxnId(body.txnid);
      setStatus("waiting");
      sendToPayU(body.paymentUrl);
      pollTimerRef.current = setTimeout(() => pollOnce(body.txnid), POLL_INTERVAL_MS);
    } catch (err) {
      closePayWindow();
      finish("error", err instanceof Error ? err.message : "Couldn't start the payment.");
    }
  }, [plan, finish, pollOnce, sendToPayU, closePayWindow]);

  // Guest checkout: triggered by the phone-form submit.
  const startGuestCheckout = useCallback(async () => {
    if (!plan) return;
    const national = phone.replace(/\D/g, "");
    if (national.length < 10) {
      setError("Please enter a valid phone number.");
      return;
    }
    // iOS: open the PayU tab NOW, synchronously within this tap, so it isn't
    // popup-blocked; we point it at PayU once create() resolves.
    if (isIOS()) {
      payWindowRef.current = window.open("about:blank", "_blank");
      try {
        payWindowRef.current?.document.write(
          '<title>Loading…</title><body style="font-family:-apple-system,sans-serif;padding:32px;color:#333">Loading secure payment…</body>',
        );
      } catch {
        /* ignore */
      }
    }
    const fullPhone = `${countryCode}${national}`;
    claimPhoneRef.current = fullPhone;
    isGuestRef.current = true;
    setError("");
    setMessage("");
    setStatus("opening");

    try {
      // Reuse an existing anonymous session if present, otherwise create one.
      let u = auth().currentUser;
      if (!u) {
        const cred = await signInAnonymously(auth());
        u = cred.user;
      }
      const token = await u.getIdToken();

      const res = await fetch("/api/payment/payu/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planId: plan.id }),
      });
      const body = await res.json();
      if (!res.ok || !body.paymentUrl) {
        closePayWindow();
        finish("error", body.error || "Couldn't start the payment. Please try again.");
        return;
      }

      // Record the phone↔txn link BEFORE showing PayU, so we never take a
      // payment we can't later attribute to a sign-in. create() only made a
      // PENDING transaction, so aborting here costs the user nothing.
      const gi = await fetch("/api/checkout/guest-init", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ txnid: body.txnid, phone: fullPhone }),
      });
      if (!gi.ok) {
        closePayWindow();
        const gb = await gi.json().catch(() => ({}));
        finish("error", gb.error || "Couldn't start checkout. Please try again.");
        return;
      }

      recordAttribution(token, body.txnid);
      if (isIOS()) {
        // iOS: PayU runs in the tab we opened on the tap; no inline iframe.
        sendToPayU(body.paymentUrl);
        setPaymentUrl(null);
      } else {
        setPaymentUrl(body.paymentUrl);
      }
      setTxnId(body.txnid);
      setStatus("waiting");
      pollTimerRef.current = setTimeout(() => pollOnce(body.txnid), POLL_INTERVAL_MS);
    } catch (err) {
      closePayWindow();
      const code = (err as { code?: string })?.code;
      if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
        // Anonymous Auth not enabled in the project — degrade gracefully to the
        // old sign-in-first flow instead of breaking checkout.
        setLoginFallback(true);
        finish("error", "Guest checkout isn't available right now — please sign in to continue.");
      } else {
        finish("error", err instanceof Error ? err.message : "Couldn't start the payment.");
      }
    }
  }, [plan, phone, countryCode, finish, pollOnce, sendToPayU, closePayWindow]);

  if (!open) return null;

  const dismissable = status !== "waiting" && status !== "opening";
  const onIOS = isIOS();
  // Android/desktop: inline iframe. iOS: a top-level tab + status panels.
  const showIframe = !onIOS && status === "waiting" && !!paymentUrl;
  const showIOSPayNow = onIOS && !isGuestRef.current && status === "opening";
  const showIOSWaiting = onIOS && status === "waiting";

  function goToLogin() {
    const q = claimPhoneRef.current
      ? `?claimPhone=${encodeURIComponent(claimPhoneRef.current)}`
      : "";
    router.push(`/auth/login${q}`);
  }

  function retry() {
    resolvedRef.current = false;
    setPaymentUrl(null);
    setTxnId(null);
    setMessage("");
    setError("");
    setLoginFallback(false);
    startedAtRef.current = Date.now();
    setStatus(isGuestRef.current ? "collect" : "opening");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-black/75"
        onClick={dismissable ? onClose : undefined}
      />
      <div className="relative w-full max-w-lg bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold">Complete your payment</h2>
            {plan && (
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {plan.name} · ₹{plan.price}
              </p>
            )}
          </div>
          <button
            onClick={dismissable ? onClose : undefined}
            disabled={!dismissable}
            className="text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {showIframe && (
            <iframe
              src={paymentUrl!}
              title="Payment"
              // Android/desktop only — iOS runs PayU in a top-level tab (see
              // isIOS()/sendToPayU) because Safari can't launch a UPI app from
              // inside a cross-origin iframe. allow-top-navigation is excluded so
              // PayU/flix.cinestry.com can't pull the whole tab out from under
              // us; allow-popups lets 3DS open an OTP window if a bank needs it.
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              className="w-full h-[70vh] bg-white border-0"
            />
          )}

          {/* iOS signed-in: a real tap is required to open the PayU tab. */}
          {showIOSPayNow && (
            <div className="px-6 py-8 space-y-4 text-center min-h-[240px] flex flex-col items-center justify-center">
              <p className="text-sm text-[var(--muted)]">
                Payment opens in a new tab. After you pay, come back to this tab — it confirms
                automatically.
              </p>
              <Button
                onClick={startSignedInCheckoutIOS}
                className="w-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-medium py-3 rounded-lg transition-colors"
              >
                Pay now
              </Button>
            </div>
          )}

          {/* iOS: PayU is in the other tab; this tab keeps polling for success. */}
          {showIOSWaiting && (
            <div className="px-6 py-8 text-center space-y-4 min-h-[240px] flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full border-4 border-[var(--primary)] border-t-transparent animate-spin" />
              <div>
                <p className="text-base font-semibold mb-1">Complete payment in the new tab</p>
                <p className="text-sm text-[var(--muted)]">
                  This screen updates automatically once your payment is confirmed — keep it open.
                </p>
              </div>
              <button
                onClick={() => {
                  if (lastPayUrlRef.current) {
                    payWindowRef.current = window.open(lastPayUrlRef.current, "_blank");
                  }
                }}
                className="text-xs text-[var(--primary)] underline underline-offset-2"
              >
                Reopen payment tab
              </button>
            </div>
          )}

          {/* Guest: collect a phone number before payment. */}
          {status === "collect" && (
            <div className="px-6 py-8 space-y-4">
              <p className="text-sm text-[var(--muted)]">
                Enter your phone number to continue. After payment you&apos;ll sign in with this
                number to activate your subscription — even if you come back later.
              </p>
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                  {error}
                </div>
              )}
              <div className="flex gap-2">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="w-24 bg-[var(--background)] border border-[var(--border)] text-white rounded-lg px-2 py-3 text-sm"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <Input
                  type="tel"
                  placeholder="Phone number"
                  value={phone}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
                  className="flex-1 bg-[var(--background)] border-[var(--border)] text-white placeholder:text-[var(--muted)] px-4 py-3 rounded-lg"
                />
              </div>
              <Button
                onClick={startGuestCheckout}
                className="w-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-medium py-3 rounded-lg transition-colors"
              >
                Continue to payment
              </Button>
            </div>
          )}

          {/* Guest: paid, now must sign in to bind the purchase. */}
          {status === "claim" && (
            <div className="px-6 py-8 text-center space-y-4 min-h-[240px] flex flex-col items-center justify-center">
              <StatusGraphic status="success" />
              <div>
                <p className="text-base font-semibold mb-1">Payment successful</p>
                <p className="text-sm text-[var(--muted)]">
                  Sign in with{" "}
                  <span className="font-medium text-[var(--foreground)]">{claimPhoneRef.current}</span>{" "}
                  to activate your subscription on your account.
                </p>
              </div>
              <div className="pt-2">
                <Button onClick={goToLogin}>Sign in to activate</Button>
              </div>
            </div>
          )}

          {!showIframe && !showIOSPayNow && !showIOSWaiting && status !== "collect" && status !== "claim" && (
            <div className="px-6 py-8 text-center space-y-4 min-h-[240px] flex flex-col items-center justify-center">
              <StatusGraphic status={status} />
              <div>
                <p className="text-base font-semibold mb-1">{statusHeading(status)}</p>
                <p className="text-sm text-[var(--muted)]">{message || statusBlurb(status)}</p>
              </div>
              {(status === "failed" || status === "error" || status === "timeout") && (
                <div className="pt-2 flex gap-3 justify-center">
                  <Button variant="secondary" onClick={onClose}>
                    Close
                  </Button>
                  {loginFallback ? (
                    <Button onClick={goToLogin}>Sign in</Button>
                  ) : (
                    <Button onClick={retry}>Try again</Button>
                  )}
                </div>
              )}
              {status === "success" && (
                <div className="pt-2">
                  <Button onClick={onClose}>Continue</Button>
                </div>
              )}
            </div>
          )}
        </div>

        {showIframe && (
          <div className="px-4 py-3 border-t border-[var(--border)] text-xs text-[var(--muted)] flex items-center justify-between shrink-0">
            <span>Do not close this window while the payment is being processed.</span>
            {txnId && <span className="font-mono opacity-70 truncate max-w-[160px]">{txnId}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// Best-effort: record the Meta attribution bundle against this transaction so
// the server can fire a matched CAPI Purchase on success. Never blocks checkout.
function recordAttribution(token: string, txnid: string): void {
  void fetch("/api/checkout/attribution", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ txnid, attribution: getAttribution() }),
  }).catch(() => {});
}

function statusHeading(s: ModalStatus): string {
  if (s === "opening") return "Starting your payment…";
  if (s === "success") return "Payment successful";
  if (s === "failed") return "Payment didn't complete";
  if (s === "error") return "Couldn't start the payment";
  if (s === "timeout") return "Still waiting…";
  return "";
}

function statusBlurb(s: ModalStatus): string {
  if (s === "opening") return "Preparing the secure payment window.";
  return "";
}

function StatusGraphic({ status }: { status: ModalStatus }) {
  if (status === "success") {
    return (
      <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
        <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (status === "failed" || status === "error") {
    return (
      <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
        <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }
  if (status === "timeout") {
    return (
      <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center">
        <svg className="w-7 h-7 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
    );
  }
  return <div className="w-12 h-12 rounded-full border-4 border-[var(--primary)] border-t-transparent animate-spin" />;
}
