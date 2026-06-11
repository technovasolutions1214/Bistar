"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { collection, query, where, orderBy, getDocs, limit } from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { Loader } from "@bistar/ui";
import { useAuth } from "@/lib/auth-context";

interface Transaction {
  id: string;
  planName?: string;
  amount?: number;
  currency?: string;
  status?: string;
  createdAt?: { toDate: () => Date };
  transactionId?: string;
}

export default function AccountPage() {
  const router = useRouter();
  const { firebaseUser, userData, loading } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);

  useEffect(() => {
    if (!loading && !firebaseUser) {
      router.replace("/auth/login");
    }
  }, [loading, firebaseUser, router]);

  useEffect(() => {
    async function fetchTransactions() {
      if (!firebaseUser) return;
      try {
        const txQ = query(
          collection(db(), "transactions"),
          where("userId", "==", firebaseUser.uid),
          orderBy("createdAt", "desc"),
          limit(20)
        );
        const snap = await getDocs(txQ);
        setTransactions(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Transaction)
        );
      } catch (error) {
        console.error("Failed to fetch transactions:", error);
      } finally {
        setTxLoading(false);
      }
    }

    if (firebaseUser) {
      fetchTransactions();
    }
  }, [firebaseUser]);

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

  // Calculate remaining days and progress
  let remainingDays = 0;
  let totalDays = 1;
  let progressPercent = 0;
  if (isActive && subscription?.startDate && subscription?.endDate) {
    const start = subscription.startDate.toDate().getTime();
    const end = subscription.endDate.toDate().getTime();
    const now = Date.now();
    totalDays = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    remainingDays = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
    progressPercent = Math.min(100, Math.max(0, (remainingDays / totalDays) * 100));
  }

  function getProgressColor(days: number) {
    if (days > 30) return "bg-green-500";
    if (days > 7) return "bg-yellow-500";
    return "bg-red-500";
  }

  function formatDate(timestamp: { toDate: () => Date } | undefined) {
    if (!timestamp) return "N/A";
    return timestamp.toDate().toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  return (
    <div className="min-h-screen pt-16">
      {/* Top Header with Gradient */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--primary)]/15 to-transparent h-48" />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-6">
          <div className="flex items-center gap-5">
            <div className="relative h-20 w-20 rounded-full overflow-hidden ring-3 ring-[var(--primary)]/30 flex-shrink-0">
              {userData.photoURL ? (
                <Image
                  src={userData.photoURL}
                  alt={userData.displayName}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full w-full bg-[var(--primary)] text-3xl font-bold text-white">
                  {userData.displayName?.[0] || "U"}
                </div>
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{userData.displayName}</h1>
              {userData.email && (
                <p className="text-sm text-[var(--muted)]">{userData.email}</p>
              )}
              {userData.phone && (
                <p className="text-sm text-[var(--muted)]">{userData.phone}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 pb-12">
        {/* Subscription Section */}
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Subscription</h2>
            {isActive && (
              <span className="px-3 py-1 text-xs font-semibold rounded-full bg-green-500/20 text-green-400">
                Active
              </span>
            )}
          </div>

          {subscription && isActive ? (
            <div className="space-y-4">
              {subscription.planName && (
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--muted)]">Last Package</span>
                  <span className="text-sm font-medium">
                    {subscription.planName}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-sm text-[var(--muted)]">Started</span>
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

              {/* Remaining days progress bar */}
              <div className="pt-2">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-[var(--muted)]">Remaining</span>
                  <span className="font-medium">{remainingDays} days left</span>
                </div>
                <div className="w-full h-2 bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getProgressColor(remainingDays)}`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
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
              {isActive ? "Add More Days" : "Subscribe Now"}
            </Link>
          </div>
        </section>

        {/* Subscription History */}
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-4">Subscription History</h2>
          {txLoading ? (
            <div className="flex justify-center py-4">
              <Loader />
            </div>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-[var(--muted)] text-center py-4">
              No transaction history found.
            </p>
          ) : (
            <div className="space-y-3">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)] border border-[var(--border)]"
                >
                  <div>
                    <p className="text-sm font-medium">{tx.planName || "Subscription"}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {tx.createdAt ? formatDate(tx.createdAt) : "N/A"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {tx.currency === "INR" ? "\u20B9" : "$"}{tx.amount}
                    </p>
                    <span className={`text-xs font-medium ${tx.status === "success" ? "text-green-400" : tx.status === "failed" ? "text-red-400" : "text-yellow-400"}`}>
                      {tx.status || "pending"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Account Actions */}
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-4">Account</h2>
          <p className="text-xs text-[var(--muted)] mb-1">
            Member since {formatDate(userData.createdAt)}
          </p>
        </section>
      </div>
    </div>
  );
}
