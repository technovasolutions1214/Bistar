"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@bistar/ui";
import { useAuth, isActiveSubscription } from "@/lib/auth-context";
import { guestCheckoutFor } from "@/lib/guest-checkout";

// Same cadence and window as the payment modal's own polling.
const POLL_INTERVAL_MS = 3000;
const MAX_PENDING_MS = 20 * 60 * 1000;

/**
 * Picks a guest's payment back up on /plans.
 *
 * The payment modal shows "Sign in to activate" when a guest's payment lands,
 * but only if it is still open. Coming back from a UPI app often reloads the
 * tab, and a closed or reloaded window used to drop the buyer on an empty
 * phone box with no sign that they had paid — inviting them to pay again.
 *
 * A guest has paid if either:
 *   * their anonymous session already holds an active subscription — the
 *     webhook grants it there, so this catches ANY paid attempt, including
 *     an earlier one that landed after they started another; or
 *   * the last remembered transaction comes back successful. Polled quietly
 *     while it could still be in flight: a closed PayU window stays
 *     "pending" forever, so announcing "checking your payment" would mislead
 *     everyone who simply abandoned one.
 * Either way the subscription isn't theirs until they verify the phone that
 * payment was made with, so name that number when we remember it — and only
 * that one: a guest may have retried with a different number.
 */
export function GuestPaymentResume() {
  const { firebaseUser, userData, loading } = useAuth();
  const router = useRouter();
  const [paidTxn, setPaidTxn] = useState<string | null>(null);

  useEffect(() => {
    setPaidTxn(null);
    if (loading || !firebaseUser) return;
    const g = guestCheckoutFor(firebaseUser);
    if (!g?.txnid) return;
    const { txnid, startedAt } = g;
    const stillInFlight = () => startedAt !== undefined && Date.now() - startedAt < MAX_PENDING_MS;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch(`/api/payment/status?txnId=${encodeURIComponent(txnid)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.ok) {
          const body = (await res.json()) as { status: "pending" | "success" | "failed" };
          if (body.status === "success") {
            setPaidTxn(txnid);
            return;
          }
          if (body.status === "failed") return;
        }
      } catch {
        if (cancelled) return;
      }
      if (stillInFlight()) timer = setTimeout(check, POLL_INTERVAL_MS);
    };
    check();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [firebaseUser, loading]);

  if (!firebaseUser?.isAnonymous) return null;
  const sub = userData?.subscription;
  const subTxn = isActiveSubscription(sub) ? sub?.transactionId ?? "" : null;
  if (!paidTxn && subTxn === null) return null;

  // Read at render, not once: the modal may have remembered a checkout since.
  const phones = guestCheckoutFor(firebaseUser)?.phones ?? {};
  const phone = (paidTxn && phones[paidTxn]) || (subTxn && phones[subTxn]) || "";

  return (
    <div className="mb-8 max-w-xl mx-auto p-4 bg-[var(--primary)]/10 border border-[var(--primary)]/30 rounded-xl flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold">Payment received</p>
        <p className="text-xs text-[var(--muted)]">
          {phone ? (
            <>
              Sign in with <span className="font-medium text-[var(--foreground)]">{phone}</span> to
              activate your subscription.
            </>
          ) : (
            <>Sign in with the phone number you paid with to activate your subscription.</>
          )}
        </p>
      </div>
      <Button
        onClick={() =>
          router.push(phone ? `/auth/login?claimPhone=${encodeURIComponent(phone)}` : "/auth/login")
        }
        className="btn-gold px-4 py-2 rounded-lg text-sm font-medium flex-shrink-0"
      >
        Sign in to activate
      </Button>
    </div>
  );
}
