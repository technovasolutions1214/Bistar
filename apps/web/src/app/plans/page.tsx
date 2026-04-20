"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { Loader } from "@novaflix/ui";
import { useAuth } from "@/lib/auth-context";
import { track } from "@/lib/pixel";

import type { Plan } from "@novaflix/shared";

export default function PlansPage() {
  const router = useRouter();
  const { firebaseUser, userData, loading: authLoading } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPlans() {
      try {
        const plansQ = query(
          collection(db(), "plans"),
          where("isActive", "==", true),
          orderBy("order", "asc")
        );
        const snap = await getDocs(plansQ);
        setPlans(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Plan));
      } catch (error) {
        console.error("Failed to fetch plans:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchPlans();
  }, []);

  async function handleSubscribe(plan: Plan) {
    if (!firebaseUser || !userData) {
      router.push("/auth/login");
      return;
    }

    setError(null);
    setProcessingPlanId(plan.id);

    // Fire InitiateCheckout BEFORE the redirect — once we navigate away the
    // page is gone and any deferred fbq call in the network buffer is lost.
    track("InitiateCheckout", {
      content_ids: [plan.id],
      content_name: plan.name,
      value: plan.price,
      currency: "INR",
      num_items: 1,
    });

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/payment/payu/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planId: plan.id }),
      });

      const body = await res.json();

      if (!res.ok || !body.paymentUrl) {
        setError(body.error || "Failed to start payment. Please try again.");
        setProcessingPlanId(null);
        return;
      }

      // Redirect to PayU (via flix.cinestry.com)
      window.location.href = body.paymentUrl;
    } catch (err) {
      console.error("Failed to initiate payment:", err);
      setError("Something went wrong. Please try again.");
      setProcessingPlanId(null);
    }
  }

  // Compute remaining days for the current subscription (if any)
  const subscription = userData?.subscription;
  const remainingDays = (() => {
    if (!subscription || subscription.status !== "active") return 0;
    const endDate =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (subscription.endDate as any)?.toDate?.() ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Date(subscription.endDate as any);
    if (!(endDate instanceof Date) || isNaN(endDate.getTime())) return 0;
    const diff = endDate.getTime() - Date.now();
    return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
  })();

  const hasActiveSub = remainingDays > 0;

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader />
      </div>
    );
  }

  // Determine the "popular" plan (middle one, or the second if even)
  const popularIndex = Math.floor(plans.length / 2);

  return (
    <div className="min-h-screen pt-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto pb-20">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-3">
          {hasActiveSub ? "Extend Your Subscription" : "Get a Subscription"}
        </h1>
        <p className="text-[var(--muted)] max-w-lg mx-auto">
          Buy any package to add more days to your subscription. Packs stack —
          purchase as many as you want.
        </p>
      </div>

      {/* Current subscription status banner */}
      {hasActiveSub && (
        <div className="mb-8 max-w-xl mx-auto p-4 bg-[var(--primary)]/10 border border-[var(--primary)]/30 rounded-xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--primary)]/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-[var(--primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold">Your subscription is active</p>
              <p className="text-xs text-[var(--muted)]">
                {remainingDays} {remainingDays === 1 ? "day" : "days"} remaining
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-8 max-w-md mx-auto p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 text-center">
          {error}
        </div>
      )}

        {plans.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <svg className="w-20 h-20 text-[var(--muted)] mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <h3 className="text-xl font-semibold mb-2">No Plans Available</h3>
            <p className="text-sm text-[var(--muted)] max-w-sm">
              Subscription plans are not available at the moment. Please check back later.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {plans.map((plan, index) => {
              const isPopular = index === popularIndex && plans.length > 1;
              const pricePerDay = plan.duration > 0
                ? (plan.price / plan.duration).toFixed(2)
                : null;

              return (
                <div
                  key={plan.id}
                  className={`relative bg-[var(--card)] border rounded-2xl p-6 flex flex-col transition-all duration-300 hover:scale-[1.02] ${
                    isPopular
                      ? "border-[var(--primary)] ring-2 ring-[var(--primary)] shadow-2xl shadow-[var(--primary)]/20 scale-105"
                      : "border-[var(--border)]"
                  }`}
                >
                  {/* Popular Badge */}
                  {isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-5 py-1.5 bg-gradient-to-r from-[var(--primary)] to-orange-500 text-white text-xs font-bold rounded-full uppercase tracking-wider">
                      Best Value
                    </div>
                  )}

                  <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                  <p className="text-sm text-[var(--muted)] mb-4">
                    {plan.description}
                  </p>

                  <div className="mb-2">
                    <span className="text-sm text-[var(--muted)] align-top">
                      {plan.currency === "INR" ? "\u20B9" : "$"}
                    </span>
                    <span className="text-5xl font-bold">
                      {plan.price}
                    </span>
                    <span className="text-sm text-[var(--muted)] ml-1">
                      / {plan.duration} {plan.duration === 1 ? "day" : "days"}
                    </span>
                  </div>
                  {pricePerDay && (
                    <p className="text-xs text-[var(--muted)] mb-6">
                      {plan.currency === "INR" ? "\u20B9" : "$"}{pricePerDay} per day
                    </p>
                  )}

                  {/* Features */}
                  <ul className="space-y-3 mb-8 flex-1">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm">
                        <svg
                          className="w-5 h-5 text-[var(--primary)] flex-shrink-0 mt-0.5"
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
                        <span className="text-[var(--muted)]">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => handleSubscribe(plan)}
                    disabled={processingPlanId === plan.id}
                    className={`w-full py-3 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 ${
                      processingPlanId === plan.id
                        ? "bg-[var(--card-hover)] text-[var(--muted)] cursor-wait"
                        : isPopular
                          ? "bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]"
                          : "bg-white/10 text-white hover:bg-white/20"
                    }`}
                  >
                    {processingPlanId === plan.id && (
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {processingPlanId === plan.id
                      ? "Redirecting\u2026"
                      : hasActiveSub
                        ? `Add ${plan.duration} ${plan.duration === 1 ? "day" : "days"}`
                        : `Get ${plan.duration} ${plan.duration === 1 ? "day" : "days"}`}
                  </button>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
