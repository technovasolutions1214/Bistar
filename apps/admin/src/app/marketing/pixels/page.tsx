"use client";
import React, { useCallback, useEffect, useState } from "react";
import { collection, getDocs, doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { MarketingShell } from "@/components/marketing-shell";
import { Button, Input, Loader, useToast } from "@bistar/ui";

interface AdAccount {
  id: string;
  label: string;
}
interface Pixel {
  slug: string;
  pixelId: string;
  label: string;
  isDefault: boolean;
  hasToken: boolean;
  adAccounts: AdAccount[];
}

function parseAccounts(text: string): AdAccount[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [id, ...rest] = l.split(",");
      return { id: id.trim(), label: rest.join(",").trim() || id.trim() };
    })
    .filter((a) => a.id);
}
function accountsToText(accts: AdAccount[]): string {
  return (accts || [])
    .map((a) => (a.label && a.label !== a.id ? `${a.id}, ${a.label}` : a.id))
    .join("\n");
}

const EMPTY_FORM = { slug: "", pixelId: "", label: "", isDefault: false, accountsText: "", token: "" };

export default function MarketingPixelsPage() {
  const toast = useToast();
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // slug being edited, or "__new__"
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db(), "pixels"));
      setPixels(
        snap.docs.map((d) => {
          const data = d.data() as Partial<Pixel>;
          return {
            slug: d.id,
            pixelId: data.pixelId ?? "",
            label: data.label ?? "",
            isDefault: !!data.isDefault,
            hasToken: !!data.hasToken,
            adAccounts: data.adAccounts ?? [],
          };
        })
      );
    } catch {
      toast.error("Failed to load pixels");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  function startNew() {
    setForm({ ...EMPTY_FORM });
    setEditing("__new__");
  }
  function startEdit(p: Pixel) {
    setForm({
      slug: p.slug,
      pixelId: p.pixelId,
      label: p.label,
      isDefault: p.isDefault,
      accountsText: accountsToText(p.adAccounts),
      token: "",
    });
    setEditing(p.slug);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const slug = form.slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (!slug) return toast.error("A slug is required (letters, numbers, - or _)");
    if (!form.pixelId.trim()) return toast.error("Pixel ID is required");

    setSaving(true);
    try {
      const isNew = editing === "__new__";
      const existing = pixels.find((p) => p.slug === slug);

      // Only one default — clear the flag on any other default pixels.
      if (form.isDefault) {
        await Promise.all(
          pixels
            .filter((p) => p.isDefault && p.slug !== slug)
            .map((p) => setDoc(doc(db(), "pixels", p.slug), { isDefault: false }, { merge: true }))
        );
      }

      const hasToken = form.token.trim().length > 0 || existing?.hasToken || false;
      await setDoc(
        doc(db(), "pixels", slug),
        {
          slug,
          pixelId: form.pixelId.trim(),
          label: form.label.trim(),
          isDefault: form.isDefault,
          adAccounts: parseAccounts(form.accountsText),
          hasToken,
          updatedAt: new Date(),
          ...(isNew ? { createdAt: new Date() } : {}),
        },
        { merge: true }
      );

      // CAPI token is write-only: stored in the server-only pixelSecrets doc and
      // never read back. Blank means "keep the existing token".
      if (form.token.trim()) {
        await setDoc(
          doc(db(), "pixelSecrets", slug),
          { capiToken: form.token.trim(), updatedAt: new Date() },
          { merge: true }
        );
      }

      toast.success("Pixel saved");
      setEditing(null);
      load();
    } catch (err) {
      console.error("save pixel:", err);
      toast.error("Failed to save pixel");
    } finally {
      setSaving(false);
    }
  }

  async function remove(slug: string) {
    if (!window.confirm(`Delete pixel "${slug}"? Ads pointing at ?c=${slug} will fall back to the default pixel.`)) return;
    try {
      await deleteDoc(doc(db(), "pixels", slug));
      await deleteDoc(doc(db(), "pixelSecrets", slug)).catch(() => {});
      toast.success("Pixel deleted");
      load();
    } catch {
      toast.error("Failed to delete pixel");
    }
  }

  function urlTemplate(slug: string, acct: string) {
    const a = acct || "<AD_ACCOUNT_ID>";
    return `https://<your-site>/?c=${slug}&acct=${a}&utm_source=meta&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}`;
  }

  return (
    <MarketingShell>
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--muted)]">
            Each pixel maps to a campaign slug. Point your ad&apos;s destination URL at <code className="text-[var(--foreground)]">?c=&lt;slug&gt;</code> so we load the right pixel and attribute purchases to it.
          </p>
          {editing === null && <Button onClick={startNew}>New pixel</Button>}
        </div>

        {editing !== null && (
          <form onSubmit={save} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 space-y-3">
            <h2 className="text-lg font-semibold">{editing === "__new__" ? "Add pixel" : `Edit ${editing}`}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm space-y-1">
                <span className="text-[var(--muted)]">Slug (used in ?c=)</span>
                <Input value={form.slug} disabled={editing !== "__new__"} placeholder="e.g. summer-a" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, slug: e.target.value })} className="w-full" />
              </label>
              <label className="text-sm space-y-1">
                <span className="text-[var(--muted)]">Label</span>
                <Input value={form.label} placeholder="e.g. Summer Campaign (Pixel A)" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, label: e.target.value })} className="w-full" />
              </label>
              <label className="text-sm space-y-1">
                <span className="text-[var(--muted)]">Meta Pixel ID</span>
                <Input value={form.pixelId} placeholder="15-16 digit pixel id" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, pixelId: e.target.value })} className="w-full" />
              </label>
              <label className="text-sm space-y-1">
                <span className="text-[var(--muted)]">CAPI access token {editing !== "__new__" && "(blank = keep)"}</span>
                <Input type="password" value={form.token} placeholder="System User token" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, token: e.target.value })} className="w-full" />
              </label>
            </div>
            <label className="text-sm space-y-1 block">
              <span className="text-[var(--muted)]">Ad accounts (one per line — <code>id, label</code>)</span>
              <textarea value={form.accountsText} onChange={(e) => setForm({ ...form, accountsText: e.target.value })} rows={3} placeholder={"act_123456789, Main account\nact_987654321, Retargeting"} className="w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              <span>Default pixel (used for untagged / direct traffic)</span>
            </label>
            <div className="flex gap-2 pt-1">
              <Button type="submit" loading={saving}>Save pixel</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="py-10 flex justify-center"><Loader /></div>
        ) : pixels.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No pixels configured yet. Add one to start tracking.</p>
        ) : (
          <div className="space-y-3">
            {pixels.map((p) => (
              <div key={p.slug} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {p.label || p.slug}
                      {p.isDefault && <span className="ml-2 text-xs text-[var(--primary)]">default</span>}
                      {!p.hasToken && <span className="ml-2 text-xs text-[var(--danger)]">no CAPI token</span>}
                    </p>
                    <p className="text-xs text-[var(--muted)] mt-0.5 font-mono truncate">
                      ?c={p.slug} · pixel {p.pixelId} · {p.adAccounts.length} account(s)
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="secondary" size="sm" onClick={() => startEdit(p)}>Edit</Button>
                    <Button variant="secondary" size="sm" onClick={() => remove(p.slug)}>Delete</Button>
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-xs text-[var(--muted)] mb-1">Ad destination URL (set Meta&apos;s URL parameters field with the macros):</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[11px] bg-[var(--background)] border border-[var(--border)] rounded px-2 py-1.5 overflow-x-auto whitespace-nowrap">
                      {urlTemplate(p.slug, p.adAccounts[0]?.id || "")}
                    </code>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard?.writeText(urlTemplate(p.slug, p.adAccounts[0]?.id || ""));
                        toast.success("Template copied");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </MarketingShell>
  );
}
