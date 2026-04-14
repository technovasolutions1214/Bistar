"use client";
import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Input, Loader, Button } from "@novaflix/ui";
import type { User } from "@novaflix/shared";

const ITEMS_PER_PAGE = 15;

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expired" | "none">("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    async function fetchUsers() {
      try {
        const q = query(collection(db(), "users"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        setUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() } as User)));
      } catch (err) {
        console.error("Failed to fetch users:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchUsers();
  }, []);

  const filtered = useMemo(() => {
    return users.filter((user) => {
      const matchSearch =
        !search ||
        user.displayName?.toLowerCase().includes(search.toLowerCase()) ||
        user.email?.toLowerCase().includes(search.toLowerCase());
      const subStatus = user.subscription?.status;
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "none" && !subStatus) ||
        subStatus === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [users, search, statusFilter]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const subBadge = (status?: string) => {
    switch (status) {
      case "active":
        return "bg-[var(--success)]/10 text-[var(--success)]";
      case "expired":
        return "bg-[var(--danger)]/10 text-[var(--danger)]";
      case "cancelled":
        return "bg-[var(--warning)]/10 text-[var(--warning)]";
      default:
        return "bg-[var(--muted)]/10 text-[var(--muted)]";
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-[var(--muted)] mt-1">Manage platform users and subscriptions</p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }}
            className="px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="none">No Subscription</option>
          </select>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader /></div>
        ) : (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Name</th>
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Email</th>
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Phone</th>
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Subscription</th>
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Plan</th>
                    <th className="text-left px-4 py-3 text-[var(--muted)] font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-[var(--muted)]">No users found.</td>
                    </tr>
                  ) : (
                    paginated.map((user) => (
                      <tr
                        key={user.uid}
                        onClick={() => router.push(`/users/${user.uid}`)}
                        className="border-b border-[var(--border)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {user.photoURL ? (
                              <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-sm font-medium text-[var(--primary)]">
                                {user.displayName?.charAt(0) || "U"}
                              </div>
                            )}
                            <span className="font-medium">{user.displayName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">{user.email}</td>
                        <td className="px-4 py-3 text-[var(--muted)]">{user.phone || "-"}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs capitalize ${subBadge(user.subscription?.status)}`}>
                            {user.subscription?.status || "None"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">{user.subscription?.planName || "-"}</td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {user.createdAt?.toDate?.() ? user.createdAt.toDate().toLocaleDateString() : "N/A"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]">
                <p className="text-sm text-[var(--muted)]">
                  Showing {(page - 1) * ITEMS_PER_PAGE + 1} to {Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
                  <Button variant="secondary" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
