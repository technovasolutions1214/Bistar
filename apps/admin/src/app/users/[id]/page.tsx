"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { doc, getDoc, updateDoc, collection, getDocs, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Button, Loader, Modal, useToast } from "@novaflix/ui";
import type { User, Plan } from "@novaflix/shared";

export default function UserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.id as string;
  const toast = useToast();

  const [user, setUser] = useState<User | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Modals
  const [showExtend, setShowExtend] = useState(false);
  const [showChangePlan, setShowChangePlan] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  // Form state
  const [extendDays, setExtendDays] = useState("30");
  const [selectedPlanId, setSelectedPlanId] = useState("");

  const fetchUser = useCallback(async () => {
    try {
      const [userSnap, plansSnap] = await Promise.all([
        getDoc(doc(db(), "users", userId)),
        getDocs(collection(db(), "plans")),
      ]);

      if (!userSnap.exists()) {
        router.replace("/users");
        return;
      }

      setUser({ uid: userSnap.id, ...userSnap.data() } as User);
      setPlans(plansSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Plan)));
    } catch (err) {
      console.error("Failed to fetch user:", err);
    } finally {
      setLoading(false);
    }
  }, [userId, router]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const handleExtend = async () => {
    if (!user?.subscription) return;
    setSaving(true);
    try {
      const currentEnd = user.subscription.endDate.toDate();
      const newEnd = new Date(currentEnd.getTime() + parseInt(extendDays) * 86400000);
      await updateDoc(doc(db(), "users", userId), {
        "subscription.endDate": Timestamp.fromDate(newEnd),
        "subscription.status": "active",
        updatedAt: serverTimestamp(),
      });
      await fetchUser();
      setShowExtend(false);
      toast.success(`Subscription extended by ${extendDays} days`);
    } catch (err) {
      console.error("Failed to extend subscription:", err);
      toast.error("Failed to extend subscription");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePlan = async () => {
    if (!selectedPlanId) return;
    setSaving(true);
    try {
      const plan = plans.find((p) => p.id === selectedPlanId);
      if (!plan) return;
      const now = new Date();
      const end = new Date(now.getTime() + plan.duration * 86400000);
      await updateDoc(doc(db(), "users", userId), {
        subscription: {
          planId: plan.id,
          planName: plan.name,
          status: "active",
          startDate: Timestamp.fromDate(now),
          endDate: Timestamp.fromDate(end),
        },
        updatedAt: serverTimestamp(),
      });
      await fetchUser();
      setShowChangePlan(false);
      toast.success("Plan changed successfully");
    } catch (err) {
      console.error("Failed to change plan:", err);
      toast.error("Failed to change plan");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db(), "users", userId), {
        "subscription.status": "cancelled",
        updatedAt: serverTimestamp(),
      });
      await fetchUser();
      setShowCancel(false);
      toast.success("Subscription cancelled");
    } catch (err) {
      console.error("Failed to cancel subscription:", err);
      toast.error("Failed to cancel subscription");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex justify-center py-20"><Loader /></div>
      </AdminLayout>
    );
  }

  if (!user) return null;

  const sub = user.subscription;

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-[var(--card)] transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold text-white">User Details</h1>
        </div>

        {/* Profile Card */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-start gap-4">
            {user.photoURL ? (
              <img src={user.photoURL} alt="" className="w-16 h-16 rounded-full" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-xl font-bold text-[var(--primary)]">
                {user.displayName?.charAt(0) || "U"}
              </div>
            )}
            <div className="flex-1">
              <h2 className="text-xl font-semibold">{user.displayName}</h2>
              <p className="text-[var(--muted)] text-sm mt-1">{user.email}</p>
              {user.phone && <p className="text-[var(--muted)] text-sm">{user.phone}</p>}
              <div className="flex items-center gap-3 mt-3">
                <span className={`text-xs px-2 py-1 rounded capitalize ${user.role === "admin" ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "bg-[var(--muted)]/10 text-[var(--muted)]"}`}>
                  {user.role}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  Joined {user.createdAt?.toDate?.() ? user.createdAt.toDate().toLocaleDateString() : "N/A"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Subscription Card */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
          {/* Status indicator strip */}
          <div className={`h-1.5 ${
            sub?.status === "active" ? "bg-[var(--success)]" : sub?.status === "expired" ? "bg-[var(--danger)]" : sub?.status === "cancelled" ? "bg-[var(--warning)]" : "bg-[var(--border)]"
          }`} />
          <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Subscription</h3>
            {sub && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize flex items-center gap-1.5 ${
                sub.status === "active" ? "bg-[var(--success)]/10 text-[var(--success)]" : sub.status === "expired" ? "bg-[var(--danger)]/10 text-[var(--danger)]" : "bg-[var(--warning)]/10 text-[var(--warning)]"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  sub.status === "active" ? "bg-[var(--success)]" : sub.status === "expired" ? "bg-[var(--danger)]" : "bg-[var(--warning)]"
                }`} />
                {sub.status}
              </span>
            )}
          </div>
          {sub ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3 rounded-lg bg-[var(--background)]">
                  <p className="text-xs text-[var(--muted)]">Plan</p>
                  <p className="text-sm font-medium mt-1">{sub.planName}</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--background)]">
                  <p className="text-xs text-[var(--muted)]">Status</p>
                  <p className={`text-sm font-medium mt-1 capitalize ${
                    sub.status === "active" ? "text-[var(--success)]" : sub.status === "expired" ? "text-[var(--danger)]" : "text-[var(--warning)]"
                  }`}>{sub.status}</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--background)]">
                  <p className="text-xs text-[var(--muted)]">Start Date</p>
                  <p className="text-sm font-medium mt-1">{sub.startDate?.toDate?.()?.toLocaleDateString() || "N/A"}</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--background)]">
                  <p className="text-xs text-[var(--muted)]">End Date</p>
                  <p className="text-sm font-medium mt-1">{sub.endDate?.toDate?.()?.toLocaleDateString() || "N/A"}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-3 pt-4 border-t border-[var(--border)]">
                <Button size="sm" onClick={() => setShowExtend(true)}>Extend Subscription</Button>
                <Button size="sm" variant="secondary" onClick={() => setShowChangePlan(true)}>Change Plan</Button>
                <Button size="sm" variant="danger" onClick={() => setShowCancel(true)}>Cancel Subscription</Button>
              </div>
            </>
          ) : (
            <div className="text-center py-6">
              <p className="text-[var(--muted)] text-sm">No active subscription.</p>
              <Button size="sm" className="mt-3" onClick={() => { setSelectedPlanId(plans[0]?.id || ""); setShowChangePlan(true); }}>
                Assign Plan
              </Button>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Extend Modal */}
      <Modal isOpen={showExtend} onClose={() => setShowExtend(false)} title="Extend Subscription" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Days to extend</label>
            <select
              value={extendDays}
              onChange={(e) => setExtendDays(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            >
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowExtend(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleExtend}>Extend</Button>
          </div>
        </div>
      </Modal>

      {/* Change Plan Modal */}
      <Modal isOpen={showChangePlan} onClose={() => setShowChangePlan(false)} title="Change Plan" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Select Plan</label>
            <select
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            >
              <option value="">Select a plan</option>
              {plans.filter((p) => p.isActive).map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.name} - ${plan.price} / {plan.duration} days</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowChangePlan(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleChangePlan} disabled={!selectedPlanId}>Change Plan</Button>
          </div>
        </div>
      </Modal>

      {/* Cancel Modal */}
      <Modal isOpen={showCancel} onClose={() => setShowCancel(false)} title="Cancel Subscription" size="sm">
        <div className="space-y-4">
          <p className="text-[var(--muted)]">
            Are you sure you want to cancel <strong className="text-[var(--foreground)]">{user.displayName}</strong>&apos;s subscription? This will set their status to cancelled.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowCancel(false)}>Keep Active</Button>
            <Button variant="danger" loading={saving} onClick={handleCancel}>Cancel Subscription</Button>
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
