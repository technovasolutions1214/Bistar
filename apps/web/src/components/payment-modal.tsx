"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@novaflix/ui";
import type { Plan } from "@novaflix/shared";
import { useAuth } from "@/lib/auth-context";
import { track } from "@/lib/pixel";

type ModalStatus = "opening" | "waiting" | "success" | "failed" | "timeout" | "cancelled" | "error";

interface PaymentModalProps {
  open: boolean;
  plan: Plan | null;
  onClose: () => void;
  onSuccess?: () => void;
}

const POLL_INTERVAL_MS = 3000;
// 20 minutes is generous for 3DS / bank OTP flows; still bounded so the tab
// doesn't poll forever if the user abandons the popup.
const MAX_POLL_DURATION_MS = 20 * 60 * 1000;

const POPUP_FEATURES = "width=520,height=720,menubar=no,toolbar=no,location=no,status=no";

export function PaymentModal({ open, plan, onClose, onSuccess }: PaymentModalProps) {
  const { firebaseUser } = useAuth();
  const [status, setStatus] = useState<ModalStatus>("opening");
  const [message, setMessage] = useState("");
  const [txnId, setTxnId] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number>(0);
  // Remember whether we've already resolved so late poll responses are ignored.
  const resolvedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (popupCheckTimerRef.current) clearInterval(popupCheckTimerRef.current);
    pollTimerRef.current = null;
    popupCheckTimerRef.current = null;
  }, []);

  const closePopup = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      try {
        popupRef.current.close();
      } catch {
        /* ignore */
      }
    }
    popupRef.current = null;
  }, []);

  // Reset state every time the modal is reopened so a second attempt starts fresh.
  useEffect(() => {
    if (!open) return;
    setStatus("opening");
    setMessage("");
    setTxnId(null);
    resolvedRef.current = false;
    startedAtRef.current = Date.now();
  }, [open]);

  // Close popup + stop timers when the modal unmounts or closes.
  useEffect(() => {
    if (!open) {
      cleanup();
      closePopup();
    }
    return () => {
      cleanup();
      closePopup();
    };
  }, [open, cleanup, closePopup]);

  const finish = useCallback(
    (next: ModalStatus, msg: string) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      cleanup();
      closePopup();
      setStatus(next);
      setMessage(msg);
    },
    [cleanup, closePopup],
  );

  const pollOnce = useCallback(
    async (id: string) => {
      if (resolvedRef.current) return;
      if (!firebaseUser) return;
      if (Date.now() - startedAtRef.current > MAX_POLL_DURATION_MS) {
        finish("timeout", "We didn't see a payment confirmation in time. If you were charged, contact support.");
        return;
      }
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch(`/api/payment/status?txnId=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!res.ok) {
          // Transient — try again on the next tick.
          pollTimerRef.current = setTimeout(() => pollOnce(id), POLL_INTERVAL_MS);
          return;
        }
        const body = (await res.json()) as { status: "pending" | "success" | "failed"; amount?: number; currency?: string; planId?: string };
        if (body.status === "success") {
          track("Subscribe", {
            content_ids: body.planId ? [body.planId] : undefined,
            value: typeof body.amount === "number" ? body.amount : undefined,
            currency: body.currency || "INR",
            transaction_id: id,
          });
          finish("success", "Your subscription is now active.");
          onSuccess?.();
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
    [firebaseUser, finish, onSuccess],
  );

  // Kick off the create-transaction + popup + polling pipeline.
  useEffect(() => {
    if (!open || !plan || !firebaseUser) return;
    let cancelled = false;

    async function start() {
      try {
        // Open the popup synchronously inside the user-gesture chain. We'll
        // navigate it to the payment URL as soon as the API returns. Blank
        // now avoids popup blockers flagging a deferred window.open.
        const popup = window.open("about:blank", "novaflix-payment", POPUP_FEATURES);
        if (!popup || popup.closed) {
          if (!cancelled) finish("error", "Your browser blocked the payment window. Please allow popups for this site and try again.");
          return;
        }
        popupRef.current = popup;

        const token = await firebaseUser!.getIdToken();
        const res = await fetch("/api/payment/payu/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ planId: plan!.id }),
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.paymentUrl) {
          finish("error", body.error || "Couldn't start the payment. Please try again.");
          return;
        }

        // Navigate the already-open popup to PayU.
        try {
          popup.location.href = body.paymentUrl;
        } catch {
          finish("error", "Payment window failed to open. Please try again.");
          return;
        }

        setTxnId(body.txnid);
        setStatus("waiting");

        // Start polling for status via our server endpoint.
        pollTimerRef.current = setTimeout(() => pollOnce(body.txnid), POLL_INTERVAL_MS);

        // Watch for the user closing the popup manually. Keep polling briefly
        // after a manual close — the PayU webhook may land seconds later.
        popupCheckTimerRef.current = setInterval(() => {
          if (!popupRef.current || popupRef.current.closed) {
            popupRef.current = null;
            if (popupCheckTimerRef.current) clearInterval(popupCheckTimerRef.current);
            popupCheckTimerRef.current = null;
            // Don't finish — let the poll run. If the webhook never fires, the
            // overall timeout handler will eventually take over.
          }
        }, 800);
      } catch (err) {
        if (!cancelled) finish("error", err instanceof Error ? err.message : "Couldn't start the payment.");
      }
    }

    start();
    return () => {
      cancelled = true;
    };
  }, [open, plan, firebaseUser, finish, pollOnce]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={status === "waiting" || status === "opening" ? undefined : onClose} />
      <div className="relative w-full max-w-md bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-lg font-semibold">Complete your payment</h2>
          {status !== "waiting" && status !== "opening" && (
            <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)]" aria-label="Close">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="px-6 py-6 text-center space-y-4">
          <StatusBody status={status} message={message} plan={plan} txnId={txnId} onRetry={() => setStatus("opening")} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}

interface StatusBodyProps {
  status: ModalStatus;
  message: string;
  plan: Plan | null;
  txnId: string | null;
  onRetry: () => void;
  onClose: () => void;
}

function StatusBody({ status, message, plan, txnId, onRetry, onClose }: StatusBodyProps) {
  if (status === "opening" || status === "waiting") {
    return (
      <>
        <Spinner />
        <p className="text-sm text-[var(--foreground)]">
          {status === "opening" ? "Opening the secure payment window…" : "Waiting for PayU to confirm your payment."}
        </p>
        <p className="text-xs text-[var(--muted)]">
          {plan ? `Plan: ${plan.name} · ₹${plan.price}` : null}
        </p>
        {status === "waiting" && (
          <p className="text-xs text-[var(--muted)]">
            Do not close this page. This window will update automatically once payment completes.
          </p>
        )}
        {txnId && <p className="text-[10px] text-[var(--muted)] tracking-widest">txn: {txnId}</p>}
      </>
    );
  }

  if (status === "success") {
    return (
      <>
        <IconCheck />
        <p className="text-lg font-semibold">Payment successful</p>
        <p className="text-sm text-[var(--muted)]">{message}</p>
        <div className="pt-2">
          <Button onClick={onClose}>Continue</Button>
        </div>
      </>
    );
  }

  if (status === "failed" || status === "error") {
    return (
      <>
        <IconCross />
        <p className="text-lg font-semibold">Payment didn't complete</p>
        <p className="text-sm text-[var(--muted)]">{message}</p>
        <div className="pt-2 flex gap-3 justify-center">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      </>
    );
  }

  if (status === "timeout") {
    return (
      <>
        <IconClock />
        <p className="text-lg font-semibold">Still waiting…</p>
        <p className="text-sm text-[var(--muted)]">{message}</p>
        <div className="pt-2 flex gap-3 justify-center">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={onRetry}>Retry</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-[var(--muted)]">{message}</p>
      <Button onClick={onClose}>Close</Button>
    </>
  );
}

function Spinner() {
  return (
    <div className="mx-auto w-12 h-12 rounded-full border-4 border-[var(--primary)] border-t-transparent animate-spin" />
  );
}

function IconCheck() {
  return (
    <div className="mx-auto w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
      <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}

function IconCross() {
  return (
    <div className="mx-auto w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
      <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  );
}

function IconClock() {
  return (
    <div className="mx-auto w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center">
      <svg className="w-7 h-7 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
  );
}
