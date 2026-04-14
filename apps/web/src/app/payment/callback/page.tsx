"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Loader } from "@novaflix/ui";

type PaymentStatus = "loading" | "success" | "failure";

export default function PaymentCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center pt-16"><Loader size="lg" /></div>}>
      <PaymentCallbackContent />
    </Suspense>
  );
}

function PaymentCallbackContent() {
  const searchParams = useSearchParams();
  const { firebaseUser } = useAuth();
  const [status, setStatus] = useState<PaymentStatus>("loading");
  const [message, setMessage] = useState("");
  const processedRef = useRef(false);

  useEffect(() => {
    async function processPayment() {
      if (processedRef.current) return;

      const paymentStatus = searchParams.get("status");
      const txnId = searchParams.get("txnId");
      const planId = searchParams.get("planId");

      if (paymentStatus !== "success" || !txnId) {
        setStatus("failure");
        setMessage(
          searchParams.get("message") || "Payment was not completed."
        );
        return;
      }

      if (!firebaseUser) {
        setStatus("failure");
        setMessage("User not authenticated. Please sign in and try again.");
        return;
      }

      processedRef.current = true;

      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await fetch("/api/payment/confirm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            userId: firebaseUser.uid,
            planId,
            transactionId: txnId,
          }),
        });

        const data = await res.json();

        if (res.ok) {
          setStatus("success");
          setMessage("Your subscription is now active!");
        } else {
          setStatus("failure");
          setMessage(data.error || "Failed to activate subscription.");
        }
      } catch {
        setStatus("failure");
        setMessage("Something went wrong. Please contact support.");
      }
    }

    processPayment();
  }, [searchParams, firebaseUser]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-16">
      <div className="w-full max-w-md text-center">
        {status === "loading" && (
          <div className="space-y-4">
            <div className="w-16 h-16 border-4 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-[var(--muted)]">Processing your payment...</p>
          </div>
        )}

        {status === "success" && (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2">Payment Successful</h2>
            <p className="text-[var(--muted)] mb-6">{message}</p>
            <Link
              href="/"
              className="inline-block px-6 py-3 bg-[var(--primary)] text-white font-medium rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
            >
              Go to Home
            </Link>
          </div>
        )}

        {status === "failure" && (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2">Payment Failed</h2>
            <p className="text-[var(--muted)] mb-6">{message}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/plans"
                className="px-6 py-3 bg-[var(--primary)] text-white font-medium rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
              >
                Try Again
              </Link>
              <Link
                href="/"
                className="px-6 py-3 bg-[var(--card)] text-white font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--card-hover)] transition-colors"
              >
                Go to Home
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
