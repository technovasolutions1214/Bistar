"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Card, Button, Loader } from "@novaflix/ui";
import type { User } from "@novaflix/shared";

interface DashboardStats {
  totalUsers: number;
  activeSubscriptions: number;
  totalContent: number;
  revenue: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentUsers, setRecentUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboard() {
      // Fetch stats independently so partial failures don't kill the whole dashboard
      let totalUsers = 0;
      let activeSubs = 0;
      let totalContent = 0;
      let totalRevenue = 0;

      // --- Stats section ---
      try {
        // Fetch users with a limit for counting
        const usersQuery = query(
          collection(db(), "users"),
          orderBy("createdAt", "desc"),
          limit(100)
        );
        const usersSnap = await getDocs(usersQuery);
        totalUsers = usersSnap.size;

        usersSnap.forEach((d) => {
          const data = d.data();
          if (data.subscription?.status === "active") {
            activeSubs++;
          }
        });

        // Fetch content with a limit for counting
        const contentQuery = query(
          collection(db(), "content"),
          orderBy("createdAt", "desc"),
          limit(100)
        );
        const contentSnap = await getDocs(contentQuery);
        totalContent = contentSnap.size;

        // Fetch revenue from analytics
        try {
          const analyticsSnap = await getDocs(collection(db(), "analytics"));
          analyticsSnap.forEach((d) => {
            totalRevenue += d.data().revenue || 0;
          });
        } catch {
          // Analytics may not exist; revenue stays 0
        }

        setStats({
          totalUsers,
          activeSubscriptions: activeSubs,
          totalContent,
          revenue: totalRevenue,
        });
      } catch (err) {
        console.error("Failed to fetch stats:", err);
        setStatsError("Failed to load dashboard statistics.");
      }

      // --- Recent users section ---
      try {
        const recentQuery = query(
          collection(db(), "users"),
          orderBy("createdAt", "desc"),
          limit(10)
        );
        const recentSnap = await getDocs(recentQuery);
        const users = recentSnap.docs.map(
          (d) => ({ uid: d.id, ...d.data() } as User)
        );
        setRecentUsers(users);
      } catch (err) {
        console.error("Failed to fetch recent users:", err);
        setUsersError("Failed to load recent users.");
      }

      setLoading(false);
    }

    fetchDashboard();
  }, []);

  const statCards = stats
    ? [
        {
          label: "Total Users",
          value: stats.totalUsers.toLocaleString(),
          icon: (
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          ),
          valueClass: "text-[var(--primary)]",
          iconBg: "bg-[var(--primary)]/10 text-[var(--primary)]",
          gradient: "from-[var(--primary)]/5 to-transparent",
        },
        {
          label: "Active Subscriptions",
          value: stats.activeSubscriptions.toLocaleString(),
          icon: (
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          valueClass: "text-[var(--success)]",
          iconBg: "bg-[var(--success)]/10 text-[var(--success)]",
          gradient: "from-[var(--success)]/5 to-transparent",
        },
        {
          label: "Total Content",
          value: stats.totalContent.toLocaleString(),
          icon: (
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-2.625 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375" />
            </svg>
          ),
          valueClass: "text-[var(--warning)]",
          iconBg: "bg-[var(--warning)]/10 text-[var(--warning)]",
          gradient: "from-[var(--warning)]/5 to-transparent",
        },
        {
          label: "Revenue",
          value: `$${stats.revenue.toLocaleString()}`,
          icon: (
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          valueClass: "text-[var(--success)]",
          iconBg: "bg-[var(--success)]/10 text-[var(--success)]",
          gradient: "from-[var(--success)]/5 to-transparent",
        },
      ]
    : [];

  return (
    <AdminLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-[var(--muted)] mt-1">Overview of your NovaFlix platform</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader />
          </div>
        ) : (
          <>
            {/* Stat Cards */}
            {statsError ? (
              <div className="bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded-xl p-6 text-center">
                <p className="text-sm text-[var(--danger)]">{statsError}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {statCards.map((stat) => (
                  <div
                    key={stat.label}
                    className={`bg-gradient-to-br ${stat.gradient} bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 hover:scale-[1.02] transition-transform duration-200 cursor-default`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-[var(--muted)]">{stat.label}</p>
                        <p className={`text-2xl font-bold mt-1 ${stat.valueClass}`}>
                          {stat.value}
                        </p>
                      </div>
                      <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${stat.iconBg}`}>
                        {stat.icon}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Quick Actions + Recent Users */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Quick Actions */}
              <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
                <div className="space-y-3">
                  <Link href="/content/new">
                    <Button variant="primary" className="w-full justify-start">
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Add New Content
                    </Button>
                  </Link>
                  <Link href="/analytics">
                    <Button variant="secondary" className="w-full justify-start mt-3">
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
                      </svg>
                      View Analytics
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Recent Signups */}
              <div className="lg:col-span-2 bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-4">Recent Signups</h2>
                {usersError ? (
                  <div className="bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded-lg p-4 text-center">
                    <p className="text-sm text-[var(--danger)]">{usersError}</p>
                  </div>
                ) : (
                <div className="divide-y divide-[var(--border)]">
                  {recentUsers.length === 0 ? (
                    <p className="text-[var(--muted)] text-sm py-6 text-center">No users yet.</p>
                  ) : (
                    recentUsers.map((user) => (
                      <Link
                        key={user.uid}
                        href={`/users/${user.uid}`}
                        className="flex items-center justify-between py-3 px-2 -mx-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {user.photoURL ? (
                            <img src={user.photoURL} alt="" className="w-9 h-9 rounded-full ring-2 ring-[var(--border)]" />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-sm font-medium text-[var(--primary)] ring-2 ring-[var(--border)]">
                              {user.displayName?.charAt(0) || "U"}
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-medium">{user.displayName}</p>
                            <p className="text-xs text-[var(--muted)]">{user.email}</p>
                          </div>
                        </div>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                            user.subscription?.status === "active"
                              ? "bg-[var(--success)]/10 text-[var(--success)]"
                              : "bg-[var(--muted)]/10 text-[var(--muted)]"
                          }`}
                        >
                          {user.subscription?.status || "Free"}
                        </span>
                      </Link>
                    ))
                  )}
                </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
