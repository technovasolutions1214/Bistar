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
import { normalizePhone, isCompletePhone, splitE164, formatPhone } from "@/lib/phone";
import { rememberGuestCheckout, settleGuestCheckout } from "@/lib/guest-checkout";

type ModalStatus =
  | "collect" // guest with no number yet: entering it before payment
  | "opening" // creating the transaction
  | "waiting" // PayU iframe shown, polling
  | "success" // paid: subscription active (a guest on this device)
  | "failed"
  | "timeout"
  | "error";

interface PaymentModalProps {
  open: boolean;
  plan: Plan | null;
  onClose: () => void;
  onSuccess?: () => void;
  /**
   * Guest checkout: the number this purchase is for (E.164), when the guest
   * has already given it. Read once as the window opens — the header, PayU
   * and the claim all use that one value.
   */
  guestPhone?: string | null;
  /** A guest typed their number in this window's own phone step. */
  onGuestPhone?: (phone: string) => void;
  /** A guest wants to correct the number in the header; the window closes. */
  onChangeNumber?: () => void;
}

// Poll the transaction doc — updated by the PayU S2S webhook at
// /api/payment/payu/webhook — every few seconds while the iframe is open.
const POLL_INTERVAL_MS = 3000;

// Enough headroom for 3-D Secure / bank OTP. If the webhook never arrives
// within this window we surface a timeout instead of polling forever.
const MAX_POLL_DURATION_MS = 20 * 60 * 1000;

const COUNTRY_CODES = ["+91", "+1", "+44", "+61", "+971"];

export function PaymentModal({
  open,
  plan,
  onClose,
  onSuccess,
  guestPhone,
  onGuestPhone,
  onChangeNumber,
}: PaymentModalProps) {
  const { firebaseUser, userData, hasActiveSubscription } = useAuth();
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
  // The guest number this checkout is for — the header, PayU and the claim.
  const [payingPhone, setPayingPhone] = useState("");

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number>(0);
  const resolvedRef = useRef(false);
  const isGuestRef = useRef(false);
  const payingPhoneRef = useRef("");
  // One per checkout attempt (each open, each retry). Work still in flight
  // from an earlier attempt checks it before touching the window.
  const attemptRef = useRef(0);
  // The attempt that should start a checkout, and the one that has. Decided
  // where the attempt begins rather than read off `status`: on the render
  // that opens the window, `status` still holds whatever the last checkout
  // left there.
  const armedForRef = useRef(-1);
  const startedForRef = useRef(-1);
  // Whether the session was already subscribed when the window opened.
  const subscribedAtOpenRef = useRef(false);

  // A "real" user is signed in and NOT anonymous. Anonymous = mid guest checkout.
  const realUser = !!firebaseUser && !firebaseUser.isAnonymous;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  // Reset everything whenever the modal reopens.
  useEffect(() => {
    if (!open) return;
    attemptRef.current += 1;
    setMessage("");
    setError("");
    setPaymentUrl(null);
    setTxnId(null);
    setLoginFallback(false);
    resolvedRef.current = false;
    startedAtRef.current = Date.now();
    // Signed-in users and guests whose number we have go straight to
    // checkout; a guest we have no number for gives it first. `guestPhone` is
    // read here, not as a dependency: it changes when the guest types their
    // number in this very window, and re-running this reset would throw them
    // back to the phone step mid-payment.
    isGuestRef.current = !realUser;
    subscribedAtOpenRef.current = hasActiveSubscription;
    const known = realUser ? "" : guestPhone || "";
    payingPhoneRef.current = known;
    setPayingPhone(known);
    if (known) {
      const { countryCode: cc, national } = splitE164(known);
      setCountryCode(cc);
      setPhone(national);
    } else {
      setPhone("");
    }
    armedForRef.current = realUser || known ? attemptRef.current : -1;
    setStatus(realUser || known ? "opening" : "collect");
  }, [open, realUser]);

  useEffect(() => {
    if (!open) {
      // Closing ends this attempt: a status poll still in flight must not
      // reschedule itself or act on a window that's gone.
      attemptRef.current += 1;
      stopPolling();
    }
    return () => stopPolling();
  }, [open, stopPolling]);

  // Leaving the page (Back mid-checkout) ends the attempt too: a create or a
  // status poll still in flight must not carry on for a window that's gone.
  useEffect(
    () => () => {
      attemptRef.current += 1;
      stopPolling();
    },
    [stopPolling],
  );

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
    async (id: string, attempt: number) => {
      if (resolvedRef.current || attemptRef.current !== attempt) return;
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
          pollTimerRef.current = setTimeout(() => pollOnce(id, attempt), POLL_INTERVAL_MS);
          return;
        }
        const body = (await res.json()) as {
          status: "pending" | "success" | "failed";
          amount?: number;
          currency?: string;
          planId?: string;
        };
        if (attemptRef.current !== attempt) return;
        if (body.status === "success") {
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
          // A guest is now subscribed on this device — the anonymous session
          // that paid holds the purchase and stays signed in. Nothing to enter.
          if (isGuestRef.current) settleGuestCheckout(id);
          finish(
            "success",
            isGuestRef.current
              ? `You're signed in as ${formatPhone(payingPhoneRef.current)}. To watch on another ` +
                  "phone or browser, sign in there with this number."
              : "Your subscription is now active.",
          );
          onSuccess?.();
          return;
        }
        if (body.status === "failed") {
          finish("failed", "Payment didn't go through. Please try again or contact support.");
          return;
        }
        pollTimerRef.current = setTimeout(() => pollOnce(id, attempt), POLL_INTERVAL_MS);
      } catch {
        pollTimerRef.current = setTimeout(() => pollOnce(id, attempt), POLL_INTERVAL_MS);
      }
    },
    [finish, onSuccess],
  );

  // Create the transaction and open PayU. Signed-in users pay on their
  // account; a guest pays under an anonymous session (made here if there
  // isn't one), and the number is linked to the transaction BEFORE PayU is
  // shown, so a guest payment can always be found by the number it was for.
  const startCheckout = useCallback(
    async (attempt: number) => {
      if (!plan) return;
      const live = () => attemptRef.current === attempt;
      const guest = isGuestRef.current;
      const fullPhone = payingPhoneRef.current;
      try {
        let u = auth().currentUser;
        if (!u && guest) {
          const cred = await signInAnonymously(auth());
          u = cred.user;
        }
        if (!u) {
          if (live()) finish("error", "Please sign in again.");
          return;
        }
        const token = await u.getIdToken();

        // Guests pass their phone on so PayU prefills it instead of asking again.
        const res = await fetch("/api/payment/payu/create", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(guest ? { planId: plan.id, phone: fullPhone } : { planId: plan.id }),
        });
        const body = await res.json();
        if (!live()) return;
        if (!res.ok || !body.paymentUrl) {
          finish("error", body.error || "Couldn't start the payment. Please try again.");
          return;
        }

        if (guest) {
          // create() only made a PENDING transaction, so aborting here costs
          // the buyer nothing.
          const gi = await fetch("/api/checkout/guest-init", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ txnid: body.txnid, phone: fullPhone }),
          });
          if (!live()) return;
          if (!gi.ok) {
            const gb = await gi.json().catch(() => ({}));
            finish("error", gb.error || "Couldn't start checkout. Please try again.");
            return;
          }
          rememberGuestCheckout({ phone: fullPhone, uid: u.uid, txnid: body.txnid, startedAt: Date.now() });
        }

        recordAttribution(token, body.txnid);
        setPaymentUrl(body.paymentUrl);
        setTxnId(body.txnid);
        setStatus("waiting");
        pollTimerRef.current = setTimeout(() => pollOnce(body.txnid, attempt), POLL_INTERVAL_MS);
      } catch (err) {
        if (!live()) return;
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
    },
    [plan, finish, pollOnce],
  );

  // Start once per attempt (an effect can run twice for one in development).
  useEffect(() => {
    if (!open || !plan || status !== "opening") return;
    const attempt = attemptRef.current;
    if (armedForRef.current !== attempt || startedForRef.current === attempt) return;
    startedForRef.current = attempt;
    void startCheckout(attempt);
  }, [open, plan, status, startCheckout]);

  // Guest with no number yet: the phone-form submit.
  function submitGuestPhone() {
    // Must match what /auth/login sends to verify-otp — reconcile compares
    // these two strings for exact equality to release the purchase.
    const fullPhone = normalizePhone(countryCode, phone);
    if (!isCompletePhone(countryCode, fullPhone)) {
      setError("Please enter a valid phone number.");
      return;
    }
    setError("");
    payingPhoneRef.current = fullPhone;
    setPayingPhone(fullPhone);
    onGuestPhone?.(fullPhone);
    armedForRef.current = attemptRef.current;
    setStatus("opening");
  }

  if (!open) return null;

  const dismissable = status !== "waiting" && status !== "opening";
  const showIframe = status === "waiting" && !!paymentUrl;

  function goToLogin() {
    router.push("/auth/login");
  }

  function retry() {
    attemptRef.current += 1;
    resolvedRef.current = false;
    stopPolling();
    setPaymentUrl(null);
    setTxnId(null);
    setMessage("");
    setError("");
    setLoginFallback(false);
    startedAtRef.current = Date.now();
    const start = !isGuestRef.current || !!payingPhoneRef.current;
    armedForRef.current = start ? attemptRef.current : -1;
    setStatus(start ? "opening" : "collect");
  }

  // The number is the header so the buyer can check it; if it's wrong, let
  // them out — even from the payment page, as long as they haven't paid.
  function changeNumber() {
    if (
      status === "waiting" &&
      !window.confirm("Only change the number if you haven't paid yet. Close this payment?")
    ) {
      return;
    }
    attemptRef.current += 1;
    stopPolling();
    onChangeNumber?.();
  }

  // Who this purchase is for, as the header: the guest's number, or the
  // signed-in account (its number, else its email).
  const accountPhone = firebaseUser?.phoneNumber || userData?.phone || "";
  const headerTitle = realUser
    ? accountPhone
      ? formatPhone(accountPhone)
      : firebaseUser?.email || userData?.email || "Your account"
    : payingPhone
      ? formatPhone(payingPhone)
      : "Enter your mobile number";
  // Not for a guest who has already paid: they are signed in as that number.
  // An earlier payment — from a window that was closed, or a tab that
  // reloaded on the way back from a UPI app — can land while this one is
  // open. Say so, so the guest doesn't pay a second time without meaning to.
  const earlierPaymentLanded =
    !realUser &&
    (status === "opening" || status === "waiting") &&
    hasActiveSubscription &&
    !subscribedAtOpenRef.current &&
    userData?.subscription?.transactionId !== txnId;
  function closeAfterEarlierPayment() {
    attemptRef.current += 1;
    stopPolling();
    onClose();
  }

  const canChangeNumber =
    !realUser &&
    !hasActiveSubscription &&
    !!payingPhone &&
    !!onChangeNumber &&
    status !== "success" &&
    status !== "collect";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-black/75"
        onClick={dismissable ? onClose : undefined}
      />
      <div className="relative w-full max-w-lg bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">Subscription for</p>
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold truncate">{headerTitle}</h2>
              {canChangeNumber && (
                <button
                  onClick={changeNumber}
                  className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] underline underline-offset-2 shrink-0"
                >
                  Change
                </button>
              )}
            </div>
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

        {earlierPaymentLanded && (
          <div className="px-6 py-3 border-b border-[var(--border)] bg-green-500/10 flex items-center justify-between gap-3 shrink-0">
            <p className="text-sm">
              Your earlier payment went through — you&apos;re subscribed. You don&apos;t need to pay
              again.
            </p>
            <Button onClick={closeAfterEarlierPayment} className="shrink-0">
              Close
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          {showIframe && (
            <iframe
              src={paymentUrl!}
              title="Payment"
              // UPI app-launch on iOS: when the user taps a UPI app, PayU inside
              // this iframe navigates to a upi://-scheme. iOS Safari only lets
              // that fire from a TOP-LEVEL context, so we grant the iframe both
              // escape routes:
              //   • allow-top-navigation — PayU can point the WHOLE TAB at the
              //     upi:// link (iOS then hands it to the UPI app and returns).
              //   • allow-popups + allow-popups-to-escape-sandbox — PayU can
              //     instead open the link in a popup (also a top-level context),
              //     and this is what 3DS/OTP windows use too.
              // (If PayU ever launches by navigating THIS iframe to upi:// rather
              // than the top/popup, iOS blocks it at the OS level and no iframe
              // attribute can override that — that case needs a top-level flow.)
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation"
              className="w-full h-[70vh] bg-white border-0"
            />
          )}

          {/* Guest: collect a phone number before payment. */}
          {status === "collect" && (
            <div className="px-6 py-8 space-y-4">
              <p className="text-sm text-[var(--muted)]">
                Your subscription goes on this number. To watch on another device later, sign in
                with it.
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
                onClick={submitGuestPhone}
                className="w-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-medium py-3 rounded-lg transition-colors"
              >
                Continue to payment
              </Button>
            </div>
          )}

          {!showIframe && status !== "collect" && (
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
