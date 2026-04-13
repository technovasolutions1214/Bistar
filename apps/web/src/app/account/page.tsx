"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Loader } from "@novaflix/ui";
import { useAuth } from "@/lib/auth-context";

export default function AccountPage() {
  const router = useRouter();
  const { firebaseUser, userData, loading } = useAuth();

  useEffect(() => {
    if (!loading && !firebaseUser) {
      router.replace("/auth/login");
    }
  }, [loading, firebaseUser, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader />
      </div>
    );
  }

  if (!firebaseUser || !userData) return null;

  const subscription = userData.subscription;
  const isActive = subscription?.status === "active";

  function formatDate(timestamp: { toDate: () => Date } | undefined) {
    if (!timestamp) return "N/A";
    return timestamp.toDate().toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  return (
    <div className="min-h-screen pt-20 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-8">My Account</h1>

      {/* Profile Section */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Profile</h2>
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16 rounded-full overflow-hidden bg-[var(--primary)] flex-shrink-0">
            {userData.photoURL ? (
              <Image
                src={userData.photoURL}
                alt={userData.displayName}
                fill
                className="object-cover"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-2xl font-bold text-white">
                {userData.displayName?.[0] || "U"}
              </div>
            )}
          </div>
          <div>
            <p className="font-medium text-lg">{userData.displayName}</p>
            {userData.email && (
              <p className="text-sm text-[var(--muted)]">{userData.email}</p>
            )}
            {userData.phone && (
              <p className="text-sm text-[var(--muted)]">{userData.phone}</p>
            )}
          </div>
        </div>
      </section>

      {/* Subscription Section */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Subscription</h2>
          {isActive && (
            <span className="px-3 py-1 text-xs font-semibold rounded-full bg-green-500/20 text-green-400">
              Active
            </span>
          )}
        </div>

        {subscription && isActive ? (
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-[var(--muted)]">Plan</span>
              <span className="text-sm font-medium">
                {subscription.planName}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--muted)]">Start Date</span>
              <span className="text-sm font-medium">
                {formatDate(subscription.startDate)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-[var(--muted)]">Expires</span>
              <span className="text-sm font-medium">
                {formatDate(subscription.endDate)}
              </span>
            </div>
            {subscription.transactionId && (
              <div className="flex justify-between">
                <span className="text-sm text-[var(--muted)]">
                  Transaction ID
                </span>
                <span className="text-sm font-medium font-mono">
                  {subscription.transactionId}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-[var(--muted)] mb-3">
              {subscription?.status === "expired"
                ? "Your subscription has expired."
                : "You don't have an active subscription."}
            </p>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-[var(--border)]">
          <Link
            href="/plans"
            className="inline-block px-5 py-2.5 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
          >
            {isActive ? "Manage Subscription" : "Subscribe Now"}
          </Link>
        </div>
      </section>

      {/* Subscription History */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Subscription History</h2>
        <p className="text-sm text-[var(--muted)] text-center py-4">
          Subscription history will appear here.
        </p>
      </section>

      {/* Account Actions */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-4">Account</h2>
        <p className="text-xs text-[var(--muted)] mb-1">
          Member since {formatDate(userData.createdAt)}
        </p>
      </section>
    </div>
  );
}
