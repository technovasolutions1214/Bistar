"use client";
import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "@novaflix/firebase-config";
import { AdminLayout } from "@/components/admin-layout";
import { Button, Input, Loader } from "@novaflix/ui";

interface PaymentParam {
  key: string;
  value: string;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Payment settings
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [paymentParams, setPaymentParams] = useState<PaymentParam[]>([]);

  // Site settings
  const [siteName, setSiteName] = useState("");
  const [existingLogo, setExistingLogo] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");

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
        }
      } catch (err) {
        console.error("Failed to fetch settings:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

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
    setSaved(false);

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
        }),
        setDoc(doc(db(), "settings", "general"), {
          siteName: siteName.trim(),
          logo: logoUrl,
          updatedAt: serverTimestamp(),
        }),
      ]);

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
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

        {/* Save */}
        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="text-sm text-[var(--success)] flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Settings saved
            </span>
          )}
          <Button loading={saving} onClick={handleSave} size="lg">
            Save Settings
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
