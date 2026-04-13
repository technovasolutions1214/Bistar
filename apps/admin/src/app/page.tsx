"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getCountFromServer, query, orderBy, limit, getDocs } from "firebase/firestore";
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

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const [usersSnap, contentSnap] = await Promise.all([
          getCountFromServer(collection(db(),"users")),
          getCountFromServer(collection(db(),"content")),
        ]);

        // Fetch recent signups
        const recentQuery = query(
          collection(db(),"users"),
          orderBy("createdAt", "desc"),
          limit(10)
        );
        const recentSnap = await getDocs(recentQuery);
        const users = recentSnap.docs.map(
          (d) => ({ uid: d.id, ...d.data() } as User)
        );

        // Count active subscriptions
        let activeSubs = 0;
        let totalRevenue = 0;
        const allUsersSnap = await getDocs(collection(db(),"users"));
        allUsersSnap.forEach((d) => {
          const data = d.data();
          if (data.subscription?.status === "active") {
            activeSubs++;
          }
        });

        // Fetch revenue from analytics
        const analyticsSnap = await getDocs(collection(db(),"analytics"));
        analyticsSnap.forEach((d) => {
          totalRevenue += d.data().revenue || 0;
        });

        setStats({
          totalUsers: usersSnap.data().count,
          activeSubscriptions: activeSubs,
          totalContent: contentSnap.data().count,
          revenue: totalRevenue,
        });
        setRecentUsers(users);
      } catch (err) {
        console.error("Failed to fetch dashboard data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();
  }, []);

  const statCards = stats
    ? [
        {
          label: "Total Users",
          value: stats.totalUsers.toLocaleString(),
          icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          ),
          color: "var(--primary)",
        },
        {
          label: "Active Subscriptions",
          value: stats.activeSubscriptions.toLocaleString(),
          icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          color: "var(--success)",
        },
        {
          label: "Total Content",
          value: stats.totalContent.toLocaleString(),
          icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-2.625 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375" />
            </svg>
          ),
          color: "var(--warning)",
        },
        {
          label: "Revenue",
          value: `$${stats.revenue.toLocaleString()}`,
          icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          color: "var(--success)",
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {statCards.map((stat) => (
                <div
                  key={stat.label}
                  className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-[var(--muted)]">{stat.label}</p>
                      <p className="text-2xl font-bold mt-1" style={{ color: stat.color }}>
                        {stat.value}
                      </p>
                    </div>
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${stat.color}15`, color: stat.color }}
                    >
                      {stat.icon}
                    </div>
                  </div>
                </div>
              ))}
            </div>

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
                <div className="space-y-3">
                  {recentUsers.length === 0 ? (
                    <p className="text-[var(--muted)] text-sm">No users yet.</p>
                  ) : (
                    recentUsers.map((user) => (
                      <div
                        key={user.uid}
                        className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          {user.photoURL ? (
                            <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-sm font-medium text-[var(--primary)]">
                              {user.displayName?.charAt(0) || "U"}
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-medium">{user.displayName}</p>
                            <p className="text-xs text-[var(--muted)]">{user.email}</p>
                          </div>
                        </div>
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${
                            user.subscription?.status === "active"
                              ? "bg-[var(--success)]/10 text-[var(--success)]"
                              : "bg-[var(--muted)]/10 text-[var(--muted)]"
                          }`}
                        >
                          {user.subscription?.status || "Free"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
