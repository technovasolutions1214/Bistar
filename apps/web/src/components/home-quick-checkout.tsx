"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInAnonymously } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@bistar/firebase-config";
import { Button, Input } from "@bistar/ui";
import type { Plan } from "@bistar/shared";
import { useAuth } from "@/lib/auth-context";
import { track } from "@/lib/pixel";
import { getAttribution } from "@/lib/attribution";

/**
 * Homepage quick-checkout: subscribe to the admin-configured DEFAULT plan
 * without leaving the home page. Guests enter a phone and run the same
 * guest/claim flow as the /plans modal; signed-in users pay directly on their
 * account (no phone, no claim). Reuses the exact sealed PayU sequence
 * (create -> guest-init -> iframe -> poll) and the identical iframe sandbox.
 *
 * Renders `fallback` (the standard "Subscribe Now -> /plans" CTA) when no valid
 * default plan is configured, so the hero always has a working call-to-action.
 */

type Status = "idle" | "opening" | "waiting" | "success" | "claim" | "failed" | "timeout" | "error";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 20 * 60 * 1000;
const COUNTRY_CODES = ["+91", "+1", "+44", "+61", "+971"];

export function HomeQuickCheckout({
  defaultPlanId,
  fallback,
}: {
  defaultPlanId: string;
  fallback: ReactNode;
}) {
  const { firebaseUser } = useAuth();
  const router = useRouter();
  const realUser = !!firebaseUser && !firebaseUser.isAnonymous;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [planChecked, setPlanChecked] = useState(false);

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [loginFallback, setLoginFallback] = useState(false);
  const [countryCode, setCountryCode] = useState("+91");
  const [phone, setPhone] = useState("");

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number>(0);
  const resolvedRef = useRef(false);
  const isGuestRef = useRef(false);
  const claimPhoneRef = useRef("");

  // Load + validate the default plan; if missing/inactive we render the fallback.
  useEffect(() => {
    if (!defaultPlanId) {
      setPlanChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db(), "plans", defaultPlanId));
        if (cancelled) return;
        if (snap.exists() && (snap.data() as Plan).isActive) {
          setPlan({ id: snap.id, ...snap.data() } as Plan);
        }
      } catch {
        /* ignore — fall back */
      } finally {
        if (!cancelled) setPlanChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultPlanId]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const finish = useCallback(
    (next: Status, msg: string) => {
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
        finish("timeout", "We didn't see a payment confirmation in time. If you were charged, contact support.");
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
          track(
            "Purchase",
            {
              content_ids: body.planId ? [body.planId] : undefined,
              value: typeof body.amount === "number" ? body.amount : undefined,
              currency: body.currency || "INR",
            },
            { eventID: id },
          );
          // Guests must sign in (claim) to bind the purchase; signed-in users
          // are already activated server-side by the webhook.
          finish(isGuestRef.current ? "claim" : "success", "");
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
    [finish],
  );

  const startCheckout = useCallback(async () => {
    if (!plan) return;

    // Guests provide a phone (drives the post-payment claim); signed-in users
    // pay directly on their account.
    let fullPhone = "";
    if (!realUser) {
      const national = phone.replace(/\D/g, "");
      if (national.length < 10) {
        setError("Please enter a valid phone number.");
        return;
      }
      fullPhone = `${countryCode}${national}`;
    }

    setError("");
    setMessage("");
    resolvedRef.current = false;
    startedAtRef.current = Date.now();
    isGuestRef.current = !realUser;
    claimPhoneRef.current = fullPhone;
    setStatus("opening");

    track("InitiateCheckout", {
      content_ids: [plan.id],
      content_name: plan.name,
      value: plan.price,
      currency: plan.currency || "INR",
      num_items: 1,
    });

    try {
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
        finish("error", body.error || "Couldn't start the payment. Please try again.");
        return;
      }

      // Guests: record the phone↔txn link BEFORE showing PayU (same as the
      // /plans modal) so a paid guest can always be reconciled at sign-in.
      if (isGuestRef.current) {
        const gi = await fetch("/api/checkout/guest-init", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ txnid: body.txnid, phone: fullPhone }),
        });
        if (!gi.ok) {
          const gb = await gi.json().catch(() => ({}));
          finish("error", gb.error || "Couldn't start checkout. Please try again.");
          return;
        }
      }

      recordAttribution(token, body.txnid);
      setPaymentUrl(body.paymentUrl);
      setStatus("waiting");
      pollTimerRef.current = setTimeout(() => pollOnce(body.txnid), POLL_INTERVAL_MS);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
        setLoginFallback(true);
        finish("error", "Guest checkout isn't available right now — please sign in to continue.");
      } else {
        finish("error", err instanceof Error ? err.message : "Couldn't start the payment.");
      }
    }
  }, [plan, realUser, phone, countryCode, finish, pollOnce]);

  function goToLogin() {
    const q = claimPhoneRef.current ? `?claimPhone=${encodeURIComponent(claimPhoneRef.current)}` : "";
    router.push(`/auth/login${q}`);
  }
  function retry() {
    resolvedRef.current = false;
    stopPolling();
    setPaymentUrl(null);
    setMessage("");
    setError("");
    setLoginFallback(false);
    setStatus("idle");
  }

  if (!planChecked) return null; // brief — avoids flashing the fallback before the plan resolves
  if (!plan) return <>{fallback}</>;

  const busy = status === "opening" || status === "waiting";

  return (
    <div className="w-full max-w-md text-left">
      <div className="bg-[#0a0807]/30 rounded-2xl border border-[var(--border)] overflow-hidden">
        {/* Plan summary header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-baseline justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">{plan.name}</p>
            <p className="text-xs text-[var(--muted)]">{plan.duration} days access</p>
          </div>
          <p className="text-2xl font-bold text-gold whitespace-nowrap">₹{plan.price}</p>
        </div>

        <div className="p-5">
          {status === "idle" && (
            <div className="space-y-3">
              {!realUser && (
                <>
                  <p className="text-xs text-[var(--muted)]">
                    Enter your phone number — you&apos;ll sign in with it after payment to activate.
                  </p>
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
                </>
              )}
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                  {error}
                </div>
              )}
              <button onClick={startCheckout} className="btn-gold w-full py-3.5 font-semibold rounded-xl text-base">
                {realUser ? `Subscribe · ₹${plan.price}` : "Continue to payment"}
              </button>
            </div>
          )}

          {status === "opening" && (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <div className="w-10 h-10 rounded-full border-4 border-[var(--primary)] border-t-transparent animate-spin" />
              <p className="text-sm text-[var(--muted)]">Preparing the secure payment window…</p>
            </div>
          )}

          {status === "waiting" && paymentUrl && (
            <div className="-mx-5 -mb-5">
              <iframe
                src={paymentUrl}
                title="Payment"
                // Identical sandbox to the /plans modal: allow-top-navigation +
                // popup escapes let PayU launch UPI from a top-level context on iOS.
                sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation"
                className="w-full h-[70vh] bg-white border-0"
              />
              <div className="px-4 py-2.5 border-t border-[var(--border)] text-[11px] text-[var(--muted)]">
                Do not close this page while the payment is being processed.
              </div>
            </div>
          )}

          {status === "claim" && (
            <div className="py-6 text-center space-y-3">
              <p className="text-base font-semibold">Payment successful</p>
              <p className="text-sm text-[var(--muted)]">
                Sign in with{" "}
                <span className="font-medium text-[var(--foreground)]">{claimPhoneRef.current}</span> to
                activate your subscription.
              </p>
              <Button onClick={goToLogin}>Sign in to activate</Button>
            </div>
          )}

          {status === "success" && (
            <div className="py-6 text-center space-y-3">
              <p className="text-base font-semibold">Your subscription is now active</p>
              <button
                onClick={() => window.location.reload()}
                className="btn-gold w-full py-3 font-semibold rounded-xl"
              >
                Start watching
              </button>
            </div>
          )}

          {(status === "failed" || status === "timeout" || status === "error") && (
            <div className="py-6 text-center space-y-3">
              <p className="text-base font-semibold">
                {status === "timeout" ? "Still waiting…" : "Payment didn't complete"}
              </p>
              {message && <p className="text-sm text-[var(--muted)]">{message}</p>}
              {loginFallback ? (
                <Button onClick={goToLogin}>Sign in</Button>
              ) : (
                <Button onClick={retry}>Try again</Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Change plan → full plans page (unchanged flow) */}
      {!busy && status !== "claim" && status !== "success" && (
        <div className="text-center mt-3">
          <Link
            href="/plans"
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] underline underline-offset-4 decoration-[var(--gold-3)] transition-colors"
          >
            Change plan
          </Link>
        </div>
      )}
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
