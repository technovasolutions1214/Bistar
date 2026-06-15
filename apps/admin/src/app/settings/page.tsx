"use client";
import React, { useEffect, useState, useCallback } from "react";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  deleteField,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "@bistar/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { useAuth } from "@/lib/auth-context";
import { Button, Input, Loader, Modal, useToast } from "@bistar/ui";
import type { Plan } from "@bistar/shared";

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

  // MSG91 settings
  const [msg91AuthKey, setMsg91AuthKey] = useState("");
  const [msg91WidgetId, setMsg91WidgetId] = useState("");
  const [msg91TokenAuth, setMsg91TokenAuth] = useState("");

  // PayU settings
  const [payuKey, setPayuKey] = useState("");
  const [payuSalt, setPayuSalt] = useState("");
  const [payuPaymentUrl, setPayuPaymentUrl] = useState("https://flix.cinestry.com/payu.html");
  const [payuStatusUrl, setPayuStatusUrl] = useState("https://flix.cinestry.com/payu-payment-status.html");
  const [payuProductInfo, setPayuProductInfo] = useState("cinestrydays-1415221612924");

  // Site settings
  const [siteName, setSiteName] = useState("");
  const [existingLogo, setExistingLogo] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [existingLandingBg, setExistingLandingBg] = useState("");
  const [landingBgFile, setLandingBgFile] = useState<File | null>(null);
  const [landingBgPreview, setLandingBgPreview] = useState("");
  const [metaPixelId, setMetaPixelId] = useState("");

  // Checkout — homepage default plan. savedDefaultPlanId tracks what's actually
  // LIVE (last persisted), separate from the dropdown's current selection.
  const [defaultPlanId, setDefaultPlanId] = useState("");
  const [savedDefaultPlanId, setSavedDefaultPlanId] = useState("");
  const [activePlans, setActivePlans] = useState<Plan[]>([]);

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
        const [generalSnap, msg91Snap, payuSnap, plansSnap] = await Promise.all([
          getDoc(doc(db(), "settings", "general")),
          getDoc(doc(db(), "settings", "msg91")),
          getDoc(doc(db(), "settings", "payu")),
          getDocs(collection(db(), "plans")),
        ]);

        // Active plans for the default-plan picker (filter + sort client-side
        // to avoid a composite index).
        setActivePlans(
          plansSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Plan)
            .filter((p) => p.isActive)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        );

        if (generalSnap.exists()) {
          const data = generalSnap.data();
          setSiteName(data.siteName || "");
          setExistingLogo(data.logo || "");
          setExistingLandingBg(typeof data.landingBg === "string" ? data.landingBg : "");
          setRequireSubscriptionToBrowse(data.requireSubscriptionToBrowse ?? false);
          setMetaPixelId(typeof data.metaPixelId === "string" ? data.metaPixelId : "");
          const dp = typeof data.defaultPlanId === "string" ? data.defaultPlanId : "";
          setDefaultPlanId(dp);
          setSavedDefaultPlanId(dp);
        }

        if (msg91Snap.exists()) {
          const data = msg91Snap.data();
          setMsg91AuthKey(data.authKey || "");
          setMsg91WidgetId(data.widgetId || "");
          setMsg91TokenAuth(data.tokenAuth || "");
        }

        if (payuSnap.exists()) {
          const data = payuSnap.data();
          setPayuKey(data.key || "");
          setPayuSalt(data.salt || "");
          setPayuPaymentUrl(data.paymentUrl || "https://flix.cinestry.com/payu.html");
          setPayuStatusUrl(data.statusUrl || "https://flix.cinestry.com/payu-payment-status.html");
          setPayuProductInfo(data.productInfo || "cinestrydays-1415221612924");
        }
      } catch (err) {
        console.error("Failed to fetch settings:", err);
        toast.error("Failed to load settings");
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, [toast]);

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

      // Resolve the real Firebase Auth uid server-side and grant admin on the
      // uid-keyed users doc (the exact doc the auth gate reads). The old
      // client-side flow created a doc with a RANDOM id when the person had no
      // users doc yet, so the role never matched their sign-in uid.
      const token = await firebaseUser!.getIdToken();
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(isEmail ? { email: input } : { phone: input }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddAdminError(body.error || "Failed to add admin.");
        setAddAdminLoading(false);
        return;
      }
      toast.success(
        `${input} is now an admin.` +
          (body.cleaned
            ? ` (cleared ${body.cleaned} stale entr${body.cleaned === 1 ? "y" : "ies"})`
            : ""),
      );
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
      const token = await firebaseUser!.getIdToken();
      const res = await fetch(`/api/admin/admins?uid=${encodeURIComponent(removeModalUid)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Failed to remove admin.");
        setRemoveLoading(false);
        return;
      }
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

      // Upload landing-page background if changed
      let landingBgUrl = existingLandingBg;
      if (landingBgFile) {
        const bgRef = ref(storage(), `settings/landing-bg_${Date.now()}`);
        const task = uploadBytesResumable(bgRef, landingBgFile);
        await new Promise<void>((resolve, reject) => {
          task.on("state_changed", null, reject, async () => {
            landingBgUrl = await getDownloadURL(task.snapshot.ref);
            resolve();
          });
        });
      }

      await Promise.all([
        setDoc(doc(db(), "settings", "general"), {
          siteName: siteName.trim(),
          logo: logoUrl,
          landingBg: landingBgUrl,
          requireSubscriptionToBrowse,
          // Empty string = pixel disabled. Save the trimmed value verbatim
          // (don't deleteField — admins want to be able to leave it blank
          // intentionally, and reading "" is just as effective as missing).
          metaPixelId: metaPixelId.trim(),
          // Homepage quick-checkout default plan. "" = no quick-checkout (send
          // visitors to /plans).
          defaultPlanId: defaultPlanId || "",
          updatedAt: serverTimestamp(),
        }, { merge: true }),
        setDoc(doc(db(), "settings", "msg91"), {
          authKey: msg91AuthKey.trim(),
          widgetId: msg91WidgetId.trim(),
          tokenAuth: msg91TokenAuth.trim(),
          // Drop legacy fields so nothing falls back to the wrong value
          templateId: deleteField(),
          senderId: deleteField(),
          updatedAt: serverTimestamp(),
        }, { merge: true }),
        setDoc(doc(db(), "settings", "payu"), {
          key: payuKey.trim(),
          salt: payuSalt.trim(),
          paymentUrl: payuPaymentUrl.trim(),
          statusUrl: payuStatusUrl.trim(),
          productInfo: payuProductInfo.trim(),
          updatedAt: serverTimestamp(),
        }, { merge: true }),
      ]);

      setSavedDefaultPlanId(defaultPlanId || "");
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

        {/* MSG91 SMS / OTP Settings */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">MSG91 (Phone OTP)</h2>
            <p className="text-xs text-[var(--muted)] mt-1">
              Uses the MSG91 Send-OTP widget. Get these from your MSG91 dashboard
              &rarr; Widgets &rarr; your widget.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Widget ID</label>
            <Input
              value={msg91WidgetId}
              onChange={(e) => setMsg91WidgetId(e.target.value)}
              placeholder="e.g. 356169706150383534343631"
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              Shown on MSG91 as <code>widgetId</code> in the widget configuration snippet.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Token Auth</label>
            <Input
              value={msg91TokenAuth}
              onChange={(e) => setMsg91TokenAuth(e.target.value)}
              placeholder="Widget Token Auth"
              type="password"
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              Shown on MSG91 as <code>tokenAuth</code>. Public-by-design (embedded in the browser).
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Auth Key</label>
            <Input
              value={msg91AuthKey}
              onChange={(e) => setMsg91AuthKey(e.target.value)}
              placeholder="Your MSG91 account Auth Key"
              type="password"
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              Used server-side to verify the widget&apos;s access-token. Never exposed to the browser.
            </p>
          </div>
        </div>

        {/* PayU Payment Settings */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">PayU Payment Gateway</h2>
            <p className="text-xs text-[var(--muted)] mt-1">
              Payment is routed through{" "}
              <code className="text-[var(--primary)]">flix.cinestry.com</code> which forwards to PayU.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Merchant Key</label>
            <Input
              value={payuKey}
              onChange={(e) => setPayuKey(e.target.value)}
              placeholder="e.g. rZFKW5"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Salt</label>
            <Input
              value={payuSalt}
              onChange={(e) => setPayuSalt(e.target.value)}
              placeholder="PayU Merchant Salt"
              type="password"
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              Used to generate the hash. Never exposed to the client.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Product Info</label>
            <Input
              value={payuProductInfo}
              onChange={(e) => setPayuProductInfo(e.target.value)}
              placeholder="cinestrydays-1415221612924"
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              Identifies this app on the payment gateway. Default is the Bistar code.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Payment URL</label>
            <Input
              value={payuPaymentUrl}
              onChange={(e) => setPayuPaymentUrl(e.target.value)}
              placeholder="https://flix.cinestry.com/payu.html"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Status / Callback URL</label>
            <Input
              value={payuStatusUrl}
              onChange={(e) => setPayuStatusUrl(e.target.value)}
              placeholder="https://flix.cinestry.com/payu-payment-status.html"
            />
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
              placeholder="Bistar"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Logo</label>
            <div className="flex items-center gap-4">
              {(logoPreview || existingLogo) && (
                // eslint-disable-next-line @next/next/no-img-element
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

          <div>
            <label className="block text-sm font-medium mb-2">Landing page background</label>
            <div className="space-y-3">
              {(landingBgPreview || existingLandingBg) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={landingBgPreview || existingLandingBg}
                  alt="Landing background"
                  className="w-full h-32 rounded-lg object-cover bg-[var(--background)]"
                />
              )}
              <label className="flex flex-col items-center justify-center px-4 py-4 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[var(--primary)] cursor-pointer transition-colors">
                <span className="text-sm text-[var(--muted)]">
                  {landingBgFile ? landingBgFile.name : "Click to upload background image"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setLandingBgFile(file);
                      const reader = new FileReader();
                      reader.onloadend = () => setLandingBgPreview(reader.result as string);
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </label>
              <p className="text-xs text-[var(--muted)]">
                Full-bleed image behind the homepage hero (logged-out / non-subscriber visitors). Use a
                large landscape image (≈1920×1080). A warm gradient shows if none is set.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Meta Pixel ID</label>
            <Input
              value={metaPixelId}
              onChange={(e) => setMetaPixelId(e.target.value)}
              placeholder="e.g. 1234567890123456"
              inputMode="numeric"
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              Numeric Pixel ID from Meta Events Manager. Leave blank to disable Meta Pixel
              entirely on the consumer site — no script will load and no events will fire.
            </p>
          </div>
        </div>

        {/* Checkout — homepage default plan */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Checkout</h2>
          <div>
            <label className="block text-sm font-medium mb-2">Default homepage plan</label>
            <select
              value={defaultPlanId}
              onChange={(e) => setDefaultPlanId(e.target.value)}
              disabled={activePlans.length === 0}
              className="w-full bg-[var(--background)] border border-[var(--border)] text-white rounded-lg px-3 py-3 text-sm disabled:opacity-50"
            >
              <option value="">
                {activePlans.length === 0 ? "No active plans" : "— None (send visitors to the plans page) —"}
              </option>
              {activePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ₹{p.price}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--muted)] mt-1">
              Shown in the homepage quick-checkout (default plan + phone + inline payment, no page
              leave). Leave as None to send visitors to the full plans page instead.
            </p>
            {(() => {
              const lp = savedDefaultPlanId ? activePlans.find((p) => p.id === savedDefaultPlanId) : null;
              const dirty = defaultPlanId !== savedDefaultPlanId;
              return (
                <p className="text-xs mt-2 text-[var(--muted)]">
                  Live on homepage:{" "}
                  {!savedDefaultPlanId ? (
                    <span className="text-[var(--foreground)]">None — visitors go to the plans page</span>
                  ) : lp ? (
                    <span className="text-[var(--primary)] font-medium">
                      {lp.name} — ₹{lp.price}
                    </span>
                  ) : (
                    <span className="text-yellow-500">
                      selected plan is inactive — visitors go to the plans page
                    </span>
                  )}
                  {dirty && (
                    <span className="text-[var(--primary)]"> · unsaved change, click Save</span>
                  )}
                </p>
              );
            })()}
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

        <div className="flex items-center justify-end gap-3">
          <Button loading={saving} onClick={handleSave} size="lg">
            Save Settings
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
