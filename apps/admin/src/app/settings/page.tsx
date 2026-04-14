"use client";
import React, { useEffect, useState, useCallback } from "react";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "@novaflix/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { useAuth } from "@/lib/auth-context";
import { Button, Input, Loader, Modal, useToast } from "@novaflix/ui";

interface PaymentParam {
  key: string;
  value: string;
}

interface AdminUser {
  uid: string;
  email?: string;
  phone?: string;
  displayName?: string;
}

export default function SettingsPage() {
  const toast = useToast();
  const { firebaseUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Content access settings
  const [requireSubscriptionToBrowse, setRequireSubscriptionToBrowse] = useState(false);

  // Payment settings
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [paymentParams, setPaymentParams] = useState<PaymentParam[]>([]);

  // Site settings
  const [siteName, setSiteName] = useState("");
  const [existingLogo, setExistingLogo] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");

  // Admin management
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(true);
  const [addAdminInput, setAddAdminInput] = useState("");
  const [addAdminLoading, setAddAdminLoading] = useState(false);
  const [addAdminError, setAddAdminError] = useState("");
  const [removeModalUid, setRemoveModalUid] = useState<string | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const [paymentSnap, generalSnap] = await Promise.all([
          getDoc(doc(db(), "settings", "payment")),
          getDoc(doc(db(), "settings", "general")),
        ]);

        if (paymentSnap.exists()) {
          const data = paymentSnap.data();
          setGatewayUrl(data.gatewayUrl || "");
          const params = data.params || {};
          setPaymentParams(
            Object.entries(params).map(([key, value]) => ({ key, value: value as string }))
          );
        }

        if (generalSnap.exists()) {
          const data = generalSnap.data();
          setSiteName(data.siteName || "");
          setExistingLogo(data.logo || "");
          setRequireSubscriptionToBrowse(data.requireSubscriptionToBrowse ?? false);
        }
      } catch (err) {
        console.error("Failed to fetch settings:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const fetchAdmins = useCallback(async () => {
    setAdminsLoading(true);
    try {
      const q = query(collection(db(), "users"), where("role", "==", "admin"));
      const snap = await getDocs(q);
      setAdmins(
        snap.docs.map((d) => ({
          uid: d.id,
          email: d.data().email,
          phone: d.data().phone,
          displayName: d.data().displayName,
        }))
      );
    } catch (err) {
      console.error("Failed to fetch admins:", err);
    } finally {
      setAdminsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const handleAddAdmin = async () => {
    const input = addAdminInput.trim();
    if (!input) return;

    setAddAdminLoading(true);
    setAddAdminError("");

    try {
      const isPhone = /^\+?\d{7,15}$/.test(input);
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);

      if (!isPhone && !isEmail) {
        setAddAdminError("Please enter a valid email address or phone number (e.g. +919876543210)");
        setAddAdminLoading(false);
        return;
      }

      // Check if user already exists in Firestore
      const field = isEmail ? "email" : "phone";
      const q = query(collection(db(), "users"), where(field, "==", input));
      const snap = await getDocs(q);

      if (!snap.empty) {
        // User exists — update their role
        const userDoc = snap.docs[0];
        if (userDoc.data().role === "admin") {
          setAddAdminError("This user is already an admin.");
          setAddAdminLoading(false);
          return;
        }
        await updateDoc(doc(db(), "users", userDoc.id), { role: "admin", updatedAt: serverTimestamp() });
        toast.success(`${input} has been promoted to admin.`);
      } else {
        // User doesn't exist yet — pre-create their doc so when they sign in they'll be admin
        const newDocRef = doc(collection(db(), "users"));
        await setDoc(newDocRef, {
          ...(isEmail ? { email: input } : { phone: input }),
          displayName: input,
          role: "admin",
          subscription: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        toast.success(`Admin created for ${input}. They'll have admin access when they sign in.`);
      }

      setAddAdminInput("");
      fetchAdmins();
    } catch (err) {
      console.error("Failed to add admin:", err);
      toast.error("Failed to add admin. Please try again.");
    } finally {
      setAddAdminLoading(false);
    }
  };

  const handleRemoveAdmin = async () => {
    if (!removeModalUid) return;
    setRemoveLoading(true);
    try {
      await updateDoc(doc(db(), "users", removeModalUid), { role: "user", updatedAt: serverTimestamp() });
      setRemoveModalUid(null);
      fetchAdmins();
      toast.success("Admin privileges removed successfully.");
    } catch (err) {
      console.error("Failed to remove admin:", err);
      toast.error("Failed to remove admin. Please try again.");
    } finally {
      setRemoveLoading(false);
    }
  };

  const addParam = () => {
    setPaymentParams([...paymentParams, { key: "", value: "" }]);
  };

  const removeParam = (index: number) => {
    setPaymentParams(paymentParams.filter((_, i) => i !== index));
  };

  const updateParam = (index: number, field: "key" | "value", val: string) => {
    const updated = [...paymentParams];
    updated[index][field] = val;
    setPaymentParams(updated);
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      // Upload logo if changed
      let logoUrl = existingLogo;
      if (logoFile) {
        const storageRef = ref(storage(), `settings/logo_${Date.now()}`);
        const task = uploadBytesResumable(storageRef, logoFile);
        await new Promise<void>((resolve, reject) => {
          task.on("state_changed", null, reject, async () => {
            logoUrl = await getDownloadURL(task.snapshot.ref);
            resolve();
          });
        });
      }

      // Save payment settings
      const paramsObj: Record<string, string> = {};
      paymentParams.forEach((p) => {
        if (p.key.trim()) paramsObj[p.key.trim()] = p.value;
      });

      await Promise.all([
        setDoc(doc(db(), "settings", "payment"), {
          gatewayUrl,
          params: paramsObj,
          updatedAt: serverTimestamp(),
        }, { merge: true }),
        setDoc(doc(db(), "settings", "general"), {
          siteName: siteName.trim(),
          logo: logoUrl,
          requireSubscriptionToBrowse,
          updatedAt: serverTimestamp(),
        }, { merge: true }),
      ]);

      toast.success("Settings saved successfully");
    } catch (err) {
      console.error("Failed to save settings:", err);
      toast.error("Failed to save settings");
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

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-[var(--muted)] mt-1">Configure platform settings</p>
        </div>

        {/* Content Access */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Content Access</h2>

          <div className="flex items-center justify-between">
            <div className="flex-1 mr-4">
              <p className="text-sm font-medium">Require subscription to browse content</p>
              <p className="text-xs text-[var(--muted)] mt-1">
                When enabled, users without an active subscription will see a paywall overlay on the homepage, browse, and content pages
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={requireSubscriptionToBrowse}
              onClick={() => setRequireSubscriptionToBrowse(!requireSubscriptionToBrowse)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                requireSubscriptionToBrowse ? "bg-[var(--primary)]" : "bg-[var(--border)]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  requireSubscriptionToBrowse ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Payment Gateway */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Payment Gateway</h2>

          <div>
            <label className="block text-sm font-medium mb-2">Gateway URL</label>
            <Input
              value={gatewayUrl}
              onChange={(e) => setGatewayUrl(e.target.value)}
              placeholder="https://payment-gateway.example.com/api"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Additional Parameters</label>
              <button
                onClick={addParam}
                className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors"
              >
                + Add Parameter
              </button>
            </div>
            <div className="space-y-2">
              {paymentParams.map((param, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={param.key}
                    onChange={(e) => updateParam(index, "key", e.target.value)}
                    placeholder="Key"
                    className="flex-1"
                  />
                  <Input
                    value={param.value}
                    onChange={(e) => updateParam(index, "value", e.target.value)}
                    placeholder="Value"
                    className="flex-1"
                  />
                  <button
                    onClick={() => removeParam(index)}
                    className="p-2 rounded-lg hover:bg-[var(--danger)]/10 text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              {paymentParams.length === 0 && (
                <p className="text-sm text-[var(--muted)] py-2">No additional parameters. Click &quot;Add Parameter&quot; to add one.</p>
              )}
            </div>
          </div>
        </div>

        {/* Site Settings */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Site Settings</h2>

          <div>
            <label className="block text-sm font-medium mb-2">Site Name</label>
            <Input
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="NovaFlix"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Logo</label>
            <div className="flex items-center gap-4">
              {(logoPreview || existingLogo) && (
                <img
                  src={logoPreview || existingLogo}
                  alt="Logo"
                  className="h-12 rounded-lg object-contain bg-[var(--background)] px-3 py-2"
                />
              )}
              <label className="flex-1 flex flex-col items-center justify-center px-4 py-4 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--primary)] cursor-pointer transition-colors">
                <span className="text-sm text-[var(--muted)]">
                  {logoFile ? logoFile.name : "Click to upload logo"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setLogoFile(file);
                      const reader = new FileReader();
                      reader.onloadend = () => setLogoPreview(reader.result as string);
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </label>
            </div>
          </div>
        </div>

        {/* Admin Management */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Admin Management</h2>
          <p className="text-sm text-[var(--muted)]">
            Add or remove admin users. Enter an email address or phone number (with country code, e.g. +919876543210).
          </p>

          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                value={addAdminInput}
                onChange={(e) => { setAddAdminInput(e.target.value); setAddAdminError(""); }}
                placeholder="email@example.com or +919876543210"
                onKeyDown={(e) => e.key === "Enter" && handleAddAdmin()}
              />
            </div>
            <Button onClick={handleAddAdmin} loading={addAdminLoading}>
              Add Admin
            </Button>
          </div>

          {addAdminError && (
            <p className="text-sm text-[var(--danger)]">{addAdminError}</p>
          )}

          {/* Admin list */}
          <div className="mt-4">
            <h3 className="text-sm font-medium text-[var(--muted)] mb-3">Current Admins</h3>
            {adminsLoading ? (
              <Loader size="sm" />
            ) : admins.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No admins found.</p>
            ) : (
              <div className="space-y-2">
                {admins.map((admin) => (
                  <div
                    key={admin.uid}
                    className="flex items-center justify-between px-4 py-3 rounded-lg bg-[var(--background)] border border-[var(--border)]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-sm font-medium">
                        {(admin.displayName || admin.email || admin.phone || "A")[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{admin.displayName || "Unnamed"}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {admin.email || admin.phone || admin.uid}
                        </p>
                      </div>
                    </div>
                    {admin.uid === firebaseUser?.uid ? (
                      <span
                        title="You cannot remove yourself"
                        className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--muted)] opacity-50 cursor-not-allowed"
                      >
                        Remove
                      </span>
                    ) : (
                      <button
                        onClick={() => setRemoveModalUid(admin.uid)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Remove Admin Confirmation Modal */}
        <Modal
          isOpen={!!removeModalUid}
          onClose={() => setRemoveModalUid(null)}
          title="Remove Admin"
          size="sm"
        >
          <p className="text-sm text-[var(--muted)] mb-4">
            Are you sure you want to remove this user&apos;s admin privileges? They will no longer be able to access the dashboard.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setRemoveModalUid(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={removeLoading} onClick={handleRemoveAdmin}>
              Remove Admin
            </Button>
          </div>
        </Modal>

        {/* Save */}
        <div className="flex items-center justify-end gap-3">
          <Button loading={saving} onClick={handleSave} size="lg">
            Save Settings
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
