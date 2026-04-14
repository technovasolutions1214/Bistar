"use client";
import React, { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@novaflix/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Button, Input, Loader, Modal, useToast } from "@novaflix/ui";
import type { Plan } from "@novaflix/shared";

interface PlanForm {
  name: string;
  description: string;
  price: string;
  currency: string;
  duration: string;
  features: string;
  isActive: boolean;
}

const emptyForm: PlanForm = {
  name: "",
  description: "",
  price: "",
  currency: "USD",
  duration: "30",
  features: "",
  isActive: true,
};

export default function PlansPage() {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);

  const fetchPlans = async () => {
    try {
      const q = query(collection(db(), "plans"), orderBy("order", "asc"));
      const snap = await getDocs(q);
      setPlans(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Plan)));
    } catch (err) {
      console.error("Failed to fetch plans:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const openAdd = () => {
    setEditingPlan(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setForm({
      name: plan.name,
      description: plan.description,
      price: plan.price.toString(),
      currency: plan.currency,
      duration: plan.duration.toString(),
      features: plan.features.join("\n"),
      isActive: plan.isActive,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.price) return;
    setSaving(true);

    const data = {
      name: form.name.trim(),
      description: form.description.trim(),
      price: parseFloat(form.price),
      currency: form.currency,
      duration: parseInt(form.duration),
      features: form.features.split("\n").map((f) => f.trim()).filter(Boolean),
      isActive: form.isActive,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingPlan) {
        await updateDoc(doc(db(), "plans", editingPlan.id), data);
        toast.success("Plan updated successfully");
      } else {
        await addDoc(collection(db(), "plans"), {
          ...data,
          order: plans.length,
          createdAt: serverTimestamp(),
        });
        toast.success("Plan created successfully");
      }
      await fetchPlans();
      setShowForm(false);
    } catch (err) {
      console.error("Failed to save plan:", err);
      toast.error("Failed to save plan");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db(), "plans", deleteTarget.id));
      await fetchPlans();
      setDeleteTarget(null);
      toast.success("Plan deleted successfully");
    } catch (err) {
      console.error("Failed to delete plan:", err);
      toast.error("Failed to delete plan");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (plan: Plan) => {
    await updateDoc(doc(db(), "plans", plan.id), {
      isActive: !plan.isActive,
      updatedAt: serverTimestamp(),
    });
    await fetchPlans();
  };

  const movePlan = async (index: number, direction: "up" | "down") => {
    const newPlans = [...plans];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newPlans.length) return;

    [newPlans[index], newPlans[swapIndex]] = [newPlans[swapIndex], newPlans[index]];

    const batch = writeBatch(db());
    newPlans.forEach((p, i) => {
      batch.update(doc(db(), "plans", p.id), { order: i });
    });
    await batch.commit();
    setPlans(newPlans);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Subscription Plans</h1>
            <p className="text-[var(--muted)] mt-1">Manage pricing plans for your platform</p>
          </div>
          <Button onClick={openAdd}>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Plan
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader /></div>
        ) : plans.length === 0 ? (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[var(--primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">No plans yet</h3>
            <p className="text-[var(--muted)] text-sm mb-6">Create your first subscription plan to start monetizing your content.</p>
            <Button onClick={openAdd}>Create Your First Plan</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map((plan, index) => (
              <div
                key={plan.id}
                className={`bg-[var(--card)] border rounded-xl overflow-hidden relative ${
                  plan.isActive ? "border-[var(--border)]" : "border-[var(--border)] opacity-60"
                }`}
              >
                {/* Gradient header */}
                <div className="h-1.5 bg-gradient-to-r from-[var(--primary)] to-[var(--primary-hover)]" />
                <div className="p-6">
                {/* Reorder */}
                <div className="absolute top-5 right-3 flex items-center gap-1">
                  <button
                    onClick={() => movePlan(index, "up")}
                    disabled={index === 0}
                    className="p-1 rounded hover:bg-[var(--background)] disabled:opacity-30"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                    </svg>
                  </button>
                  <button
                    onClick={() => movePlan(index, "down")}
                    disabled={index === plans.length - 1}
                    className="p-1 rounded hover:bg-[var(--background)] disabled:opacity-30"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                </div>

                {/* Active badge */}
                <span className={`text-xs px-2 py-0.5 rounded ${plan.isActive ? "bg-[var(--success)]/10 text-[var(--success)]" : "bg-[var(--muted)]/10 text-[var(--muted)]"}`}>
                  {plan.isActive ? "Active" : "Inactive"}
                </span>

                <h3 className="text-lg font-semibold mt-3">{plan.name}</h3>
                <p className="text-[var(--muted)] text-sm mt-1">{plan.description}</p>

                <div className="mt-4">
                  <span className="text-3xl font-bold text-[var(--primary)]">${plan.price}</span>
                  <span className="text-[var(--muted)] text-sm ml-1">/ {plan.duration} days</span>
                </div>

                {/* Features */}
                {plan.features.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-[var(--muted)]">
                        <svg className="w-4 h-4 text-[var(--success)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 mt-6 pt-4 border-t border-[var(--border)]">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(plan)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(plan)}>
                    {plan.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteTarget(plan)}>Delete</Button>
                </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editingPlan ? "Edit Plan" : "Add Plan"}
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Name *</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Premium" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short description" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Price *</label>
              <Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="9.99" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Currency</label>
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="USD" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Duration (days)</label>
              <Input type="number" min="1" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="30" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Features (one per line)</label>
            <textarea
              value={form.features}
              onChange={(e) => setForm({ ...form, features: e.target.value })}
              placeholder="HD Streaming&#10;Ad-free&#10;Download offline"
              rows={4}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-none"
            />
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)]">
            <span className="text-sm font-medium">Active</span>
            <button
              onClick={() => setForm({ ...form, isActive: !form.isActive })}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.isActive ? "bg-[var(--success)]" : "bg-[var(--border)]"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${form.isActive ? "translate-x-5" : ""}`} />
            </button>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleSave} disabled={!form.name.trim() || !form.price}>
              {editingPlan ? "Save Changes" : "Create Plan"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Plan" size="sm">
        <div className="space-y-4">
          <p className="text-[var(--muted)]">
            Are you sure you want to delete <strong className="text-[var(--foreground)]">{deleteTarget?.name}</strong>? Users on this plan will not be affected but no new subscriptions can use it.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" loading={saving} onClick={handleDelete}>Delete</Button>
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
