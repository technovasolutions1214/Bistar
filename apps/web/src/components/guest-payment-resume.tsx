"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { guestCheckoutFor, readGuestCheckout, settleGuestCheckout } from "@/lib/guest-checkout";
import { formatPhone } from "@/lib/phone";

// Same cadence and window as the payment modal's own polling.
const POLL_INTERVAL_MS = 3000;
const MAX_PENDING_MS = 20 * 60 * 1000;

/**
 * Picks a guest's payment back up on /plans.
 *
 * The payment window says "Payment successful" and moves on to the titles,
 * but only if it is still open. Coming back from a UPI app often reloads the
 * tab, and a closed or reloaded window used to drop the buyer on the plans
 * with no sign that they had paid — inviting them to pay again.
 *
 * So the last remembered transaction, if it was started before this page
 * loaded and could still be in flight, is polled quietly: a closed PayU window
 * stays "pending" forever, so announcing "checking your payment" would mislead
 * everyone who simply abandoned one. Once it succeeds the guest is subscribed
 * on this device (the webhook granted it to their session), so say so and
 * take them to the titles.
 */
export function GuestPaymentResume() {
  const { firebaseUser, loading } = useAuth();
  const mountedAt = useRef(Date.now());
  const [paid, setPaid] = useState<{ txnid: string; phone: string } | null>(null);

  useEffect(() => {
    if (loading || !firebaseUser?.isAnonymous) return;
    const g = guestCheckoutFor(firebaseUser);
    if (!g?.txnid || g.startedAt === undefined) return;
    // A checkout started on this page has its own payment window watching it.
    if (g.startedAt >= mountedAt.current) return;
    const { txnid, startedAt } = g;
    const phone = g.phones?.[txnid] ?? g.phone;
    const stillInFlight = () => Date.now() - startedAt < MAX_PENDING_MS;
    if (!stillInFlight()) return;

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
            settleGuestCheckout(txnid);
            setPaid({ txnid, phone });
            return;
          }
          if (body.status === "failed") {
            settleGuestCheckout(txnid);
            return;
          }
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

  // A full load, like the payment window's own success: home's gate reads the
  // subscription fresh instead of trusting a listener that may still lag.
  // Not while a newer checkout is under way on this page — that would pull the
  // buyer out of a payment window mid-payment; the banner says it instead.
  useEffect(() => {
    if (!paid) return;
    const latest = readGuestCheckout()?.txnid;
    if (latest && latest !== paid.txnid) return;
    const t = setTimeout(() => {
      window.location.href = "/";
    }, 1500);
    return () => clearTimeout(t);
  }, [paid]);

  if (!paid) return null;

  return (
    <div className="mb-8 max-w-xl mx-auto p-4 bg-[var(--primary)]/10 border border-[var(--primary)]/30 rounded-xl flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold">Payment received</p>
        <p className="text-xs text-[var(--muted)]">
          You&apos;re signed in as{" "}
          <span className="font-medium text-[var(--foreground)]">{formatPhone(paid.phone)}</span>. To
          watch on another phone or browser, sign in there with this number.
        </p>
      </div>
      <button
        onClick={() => {
          window.location.href = "/";
        }}
        className="btn-gold px-4 py-2 rounded-lg text-sm font-medium flex-shrink-0"
      >
        Start watching
      </button>
    </div>
  );
}
