"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { Loader } from "@novaflix/ui";
import { useAuth } from "@/lib/auth-context";
import type { Plan, PaymentSettings } from "@novaflix/shared";

export default function PlansPage() {
  const router = useRouter();
  const { firebaseUser, userData, loading: authLoading } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

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

    try {
      // Fetch payment gateway URL
      const paymentDoc = await getDoc(doc(db(), "settings", "payment"));
      if (!paymentDoc.exists()) {
        alert("Payment gateway not configured. Please contact support.");
        return;
      }

      const settings = paymentDoc.data() as PaymentSettings;
      const params = new URLSearchParams({
        userId: firebaseUser.uid,
        planId: plan.id,
        amount: plan.price.toString(),
        name: userData.displayName || "",
        email: userData.email || "",
        phone: userData.phone || "",
      });

      window.location.href = `${settings.gatewayUrl}?${params.toString()}`;
    } catch (error) {
      console.error("Failed to initiate payment:", error);
      alert("Something went wrong. Please try again.");
    }
  }

  const activePlanId = userData?.subscription?.status === "active"
    ? userData.subscription.planId
    : null;

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
    <div className="min-h-screen pt-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold mb-3">Choose Your Plan</h1>
        <p className="text-[var(--muted)] max-w-md mx-auto">
          Pick a plan that works for you. Enjoy unlimited streaming with any
          subscription.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
        {plans.map((plan, index) => {
          const isPopular = index === popularIndex && plans.length > 1;
          const isCurrent = activePlanId === plan.id;

          return (
            <div
              key={plan.id}
              className={`relative bg-[var(--card)] border rounded-2xl p-6 flex flex-col transition-transform hover:scale-[1.02] ${
                isPopular
                  ? "border-[var(--primary)] shadow-lg shadow-[var(--primary)]/10"
                  : "border-[var(--border)]"
              }`}
            >
              {/* Popular Badge */}
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-[var(--primary)] text-white text-xs font-semibold rounded-full">
                  Most Popular
                </div>
              )}

              {/* Current Plan Badge */}
              {isCurrent && (
                <div className="absolute -top-3 right-4 px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full">
                  Current Plan
                </div>
              )}

              <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
              <p className="text-sm text-[var(--muted)] mb-4">
                {plan.description}
              </p>

              <div className="mb-6">
                <span className="text-3xl font-bold">
                  {plan.currency === "INR" ? "\u20B9" : "$"}
                  {plan.price}
                </span>
                <span className="text-sm text-[var(--muted)] ml-1">
                  / {plan.duration} days
                </span>
              </div>

              {/* Features */}
              <ul className="space-y-2.5 mb-8 flex-1">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <svg
                      className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5"
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
                disabled={isCurrent}
                className={`w-full py-3 rounded-lg font-medium text-sm transition-colors ${
                  isCurrent
                    ? "bg-green-500/20 text-green-400 cursor-not-allowed"
                    : isPopular
                      ? "bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]"
                      : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {isCurrent ? "Current Plan" : "Subscribe"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
