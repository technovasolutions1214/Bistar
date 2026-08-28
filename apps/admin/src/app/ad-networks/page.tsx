"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, deleteField, doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "@bistar/firebase-config";
import { AdNetworksShell } from "@/components/ad-networks-shell";
import {
  AD_NETWORKS,
  CONFIDENCE_LABEL,
  EVENT_CATALOG,
  TEMPLATE_MACROS,
  landingUrl,
  type AdEventKey,
  type AdNetworkDef,
} from "@/lib/ad-networks";
import { markDirty } from "@/lib/dirty-networks";
import { Button, Input, Loader, useToast } from "@bistar/ui";

/**
 * Networks — the setup screen, one card per traffic source.
 *
 * Each card walks the same four steps in the order you actually do them:
 *   1. the landing URL to paste into the network's campaign,
 *   2. the postback URL to fire back at them,
 *   3. what number to send as the conversion value,
 *   4. which of our events to report.
 *
 * The prefilled values come from `@/lib/ad-networks`, which records what each
 * network publishes AND how well corroborated it is. Everything is editable,
 * because most of these networks generate a postback URL containing ids unique
 * to your account — the prefill shows the shape, your dashboard has the truth.
 */

type PayoutMode = "revenue" | "percent" | "fixed" | "none";

interface EventForm {
  enabled: boolean;
  goal: string;
  sendPayout: boolean;
}

interface NetForm {
  enabled: boolean;
  postbackUrl: string;
  method: "GET" | "POST";
  postbackBody: string;
  postbackContentType: string;
  successPattern: string;
  failurePattern: string;
  timeoutMs: number;
  maxAttempts: number;
  payoutMode: PayoutMode;
  payoutFixed: number;
  payoutPercent: number;
  payoutCurrency: string;
  fxRate: number;
  apiKey: string;
  events: Record<AdEventKey, EventForm>;
}

type StoredNet = Partial<Omit<NetForm, "events" | "apiKey">> & {
  events?: Partial<Record<AdEventKey, { enabled?: boolean; goal?: string; payoutMode?: PayoutMode }>>;
  hasApiKey?: boolean;
};

const SITE_URL_KEY = "bistar.adnetworks.siteUrl";
const KNOWN_MACROS = new Set(TEMPLATE_MACROS.map((m) => m.macro.replace(/[{}]/g, "")));

/** Fresh form for a network with nothing saved yet. */
function seedForm(net: AdNetworkDef): NetForm {
  const events = {} as Record<AdEventKey, EventForm>;
  for (const e of EVENT_CATALOG) {
    events[e.key] = {
      enabled: e.defaultOn,
      goal: net.defaultGoals?.[e.key] ?? "",
      sendPayout: true,
    };
  }
  return {
    enabled: false,
    postbackUrl: net.postbackTemplate,
    method: net.method,
    postbackBody: "",
    postbackContentType: "",
    successPattern: "",
    failurePattern: net.failurePattern ?? "",
    timeoutMs: 10000,
    maxAttempts: 5,
    // Deliberately "none" until someone chooses: several of these networks read
    // the number as USD, and sending a raw rupee amount would overstate revenue
    // ~85x and poison their optimiser. No payout still counts the conversion.
    payoutMode: "none",
    payoutFixed: 0,
    payoutPercent: 100,
    payoutCurrency: "USD",
    fxRate: 1,
    apiKey: "",
    events,
  };
}

function formFromStored(net: AdNetworkDef, s: StoredNet): NetForm {
  const base = seedForm(net);
  const events = { ...base.events };
  for (const e of EVENT_CATALOG) {
    const stored = s.events?.[e.key];
    if (stored) {
      events[e.key] = {
        enabled: !!stored.enabled,
        goal: stored.goal ?? "",
        sendPayout: stored.payoutMode !== "none",
      };
    }
  }
  return {
    ...base,
    enabled: !!s.enabled,
    postbackUrl: s.postbackUrl ?? base.postbackUrl,
    method: s.method === "POST" ? "POST" : "GET",
    postbackBody: s.postbackBody ?? "",
    postbackContentType: s.postbackContentType ?? "",
    successPattern: s.successPattern ?? "",
    failurePattern: s.failurePattern ?? base.failurePattern,
    timeoutMs: s.timeoutMs ?? base.timeoutMs,
    maxAttempts: s.maxAttempts ?? base.maxAttempts,
    payoutMode: s.payoutMode ?? base.payoutMode,
    payoutFixed: s.payoutFixed ?? 0,
    payoutPercent: s.payoutPercent ?? 100,
    payoutCurrency: s.payoutCurrency ?? "USD",
    fxRate: s.fxRate ?? 1,
    apiKey: "",
    events,
  };
}

/** Everything about a template that would quietly cost money if left alone. */
function templateProblems(f: NetForm, net: AdNetworkDef): string[] {
  const out: string[] = [];
  const tpl = f.postbackUrl.trim();
  if (!tpl) return ["No postback URL — nothing will be sent."];

  // Match macros with the SAME regex the delivery engine uses, so the panel
  // never warns about something the engine accepts (or stays quiet about
  // something it rejects). `{{ click_id }}` with spaces is valid to both.
  const present = new Set([...tpl.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]));

  if (/(YOUR_[A-Z_]+|HOST-FROM-YOUR-[A-Z-]+)/.test(tpl)) {
    out.push(
      "The URL still contains a placeholder (YOUR_…). Replace it with the real value from the network's dashboard — a postback with a placeholder in it is discarded by the network.",
    );
  }
  if (!present.has("click_id")) {
    out.push(
      "The URL has no {{click_id}} macro. Without the click id the network cannot attribute the conversion to anything.",
    );
  }
  for (const name of present) {
    if (!KNOWN_MACROS.has(name)) {
      out.push(
        `{{${name}}} is not one of our macros. The delivery engine refuses to send a URL that still contains {{…}}, so every postback for this network will fail until you fix it — HilltopAds' own {{price}}, for instance, is our {{payout}}.`,
      );
    }
  }
  // A blank goal drops the parameter, which is exactly right for PropellerAds'
  // primary conversion and HilltopAds' main conversion — but RichAds rejects a
  // call with no `action`, so only flag it where it genuinely breaks.
  if (net.goalRequired && present.has("goal")) {
    for (const e of EVENT_CATALOG) {
      const ev = f.events[e.key];
      if (ev.enabled && !ev.goal.trim()) {
        out.push(
          `"${e.label}" is on but has no goal value, and ${net.name} requires one on every call — with it blank the parameter is dropped and the postback is rejected.`,
        );
      }
    }
  }
  // Both revenue and percent multiply the order value by the same rate, so the
  // currency mistake is identical in either mode.
  const scalesRevenue = f.payoutMode === "revenue" || f.payoutMode === "percent";
  if (scalesRevenue && f.payoutCurrency !== "INR" && f.fxRate === 1) {
    out.push(
      `Payout is derived from the order value with no conversion applied, but is labelled ${f.payoutCurrency}. Our prices are in INR, so ₹499 would be reported as ${f.payoutCurrency} 499 — roughly 85× too high. Set a conversion rate below, or switch the currency to INR.`,
    );
  }
  if (scalesRevenue && f.fxRate <= 0) {
    out.push(
      "The conversion rate is zero, so every payout computes to 0 and is still sent. Enter a real rate, or switch the payout mode to “Do not send”.",
    );
  }
  if (!tpl.startsWith("https://")) {
    out.push("The URL is not https. It carries your click id and revenue — use https unless the network refuses it.");
  }
  return out;
}

function previewPayout(f: NetForm, sample = 499): string {
  const fx = f.fxRate || 0;
  if (f.payoutMode === "none") return "nothing — the payout parameter is dropped";
  if (f.payoutMode === "fixed") return `${f.payoutFixed} ${f.payoutCurrency} on every conversion`;
  const gross = f.payoutMode === "percent" ? sample * fx * (f.payoutPercent / 100) : sample * fx;
  return `₹${sample} → ${Number(gross.toFixed(4))} ${f.payoutCurrency}`;
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[var(--border)] pt-4 mt-4 first:border-0 first:pt-0 first:mt-0">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <span className="w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--on-primary)] text-[11px] flex items-center justify-center shrink-0">
          {n}
        </span>
        {title}
      </h3>
      {hint && <p className="text-xs text-[var(--muted)] mt-1 ml-7">{hint}</p>}
      <div className="mt-3 ml-0 sm:ml-7 space-y-3">{children}</div>
    </div>
  );
}

function CopyBox({ text, onCopy }: { text: string; onCopy: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <code className="flex-1 text-[11px] bg-[var(--background)] border border-[var(--border)] rounded px-2 py-1.5 overflow-x-auto break-all">
        {text}
      </code>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          navigator.clipboard?.writeText(text);
          onCopy();
        }}
      >
        Copy
      </Button>
    </div>
  );
}

const inputCls =
  "w-full bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] font-mono";

function NetworkCard({
  net,
  stored,
  siteUrl,
}: {
  net: AdNetworkDef;
  stored: StoredNet | null;
  siteUrl: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NetForm>(() => (stored ? formFromStored(net, stored) : seedForm(net)));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testId, setTestId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [testClickId, setTestClickId] = useState("");

  // Adopt server state while the form is untouched, so another admin's save (or
  // the first load) shows up without clobbering edits in progress.
  useEffect(() => {
    if (dirty) return;
    setForm(stored ? formFromStored(net, stored) : seedForm(net));
  }, [stored, net, dirty]);

  // Publish dirtiness so the tab bar can warn before a route change throws away
  // a postback URL someone just pasted out of a network dashboard.
  useEffect(() => {
    markDirty(net.slug, dirty);
    return () => markDirty(net.slug, false);
  }, [net.slug, dirty]);

  const set = <K extends keyof NetForm>(k: K, v: NetForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const setEvent = (key: AdEventKey, patch: Partial<EventForm>) => {
    setForm((f) => ({ ...f, events: { ...f.events, [key]: { ...f.events[key], ...patch } } }));
    setDirty(true);
  };

  const problems = useMemo(() => templateProblems(form, net), [form, net]);
  const conf = CONFIDENCE_LABEL[net.templateConfidence];
  const landing = landingUrl(net, siteUrl);
  const configured = !!stored;

  async function save() {
    setSaving(true);
    try {
      // payoutMode is written in BOTH directions. Omitting the key when the
      // payout is switched back on would leave the stored "none" in place —
      // setDoc(merge) deep-merges maps and never removes an absent field — so
      // re-ticking the box would silently do nothing.
      const events: Record<string, Record<string, unknown>> = {};
      for (const e of EVENT_CATALOG) {
        const ev = form.events[e.key];
        events[e.key] = {
          enabled: ev.enabled,
          goal: ev.goal.trim(),
          payoutMode: ev.sendPayout ? deleteField() : ("none" as PayoutMode),
        };
      }
      await setDoc(
        doc(db(), "adNetworks", net.slug),
        {
          slug: net.slug,
          name: net.name,
          enabled: form.enabled,
          postbackUrl: form.postbackUrl.trim(),
          method: form.method,
          postbackBody: form.postbackBody.trim(),
          postbackContentType: form.postbackContentType.trim(),
          successPattern: form.successPattern.trim(),
          failurePattern: form.failurePattern.trim(),
          timeoutMs: Number(form.timeoutMs) || 10000,
          maxAttempts: Number(form.maxAttempts) || 5,
          payoutMode: form.payoutMode,
          payoutFixed: Number(form.payoutFixed) || 0,
          payoutPercent: Number(form.payoutPercent) || 0,
          payoutCurrency: form.payoutCurrency.trim().toUpperCase() || "USD",
          fxRate: Number(form.fxRate) || 0,
          events,
          ...(form.apiKey.trim() ? { hasApiKey: true } : {}),
          updatedAt: new Date(),
          ...(configured ? {} : { createdAt: new Date() }),
        },
        { merge: true },
      );

      // Write-only: the key goes to a collection no client can read back.
      if (form.apiKey.trim()) {
        await setDoc(
          doc(db(), "adNetworkSecrets", net.slug),
          { apiKey: form.apiKey.trim(), updatedAt: new Date() },
          { merge: true },
        );
      }
      setForm((f) => ({ ...f, apiKey: "" }));
      setDirty(false);
      toast.success(`${net.name} saved`);
    } catch (err) {
      console.error("save network:", err);
      toast.error("Could not save. Only admins can change this.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the ${net.name} configuration? Conversions from ?net=${net.slug} will stop being posted back.`))
      return;
    try {
      await deleteDoc(doc(db(), "adNetworks", net.slug));
      await deleteDoc(doc(db(), "adNetworkSecrets", net.slug)).catch(() => {});
      setDirty(false);
      toast.success("Configuration deleted");
    } catch {
      toast.error("Could not delete");
    }
  }

  async function fire(dryRun: boolean) {
    if (dirty) return toast.error("Save your changes first — the test uses the saved configuration.");
    setTestResult(null);
    setTestId(null);
    try {
      const u = auth().currentUser;
      if (!u) return toast.error("Sign in again.");
      const token = await u.getIdToken();
      const res = await fetch("/api/admin/postbacks/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          network: net.slug,
          event: "purchase",
          dryRun,
          revenue: 499,
          clickId: testClickId.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Test failed");
      setTestId(body.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    }
  }

  // Watch the test row until the delivery function stamps its result on it.
  useEffect(() => {
    if (!testId) return;
    const unsub = onSnapshot(doc(db(), "adPostbacks", testId), (s) => {
      if (s.exists()) setTestResult(s.data() as Record<string, unknown>);
    });
    return () => unsub();
  }, [testId]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 p-4 text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold flex items-center gap-2 flex-wrap">
            {net.name}
            {/* Driven by `stored`, not the draft — a badge reading "live" for an
                edit nobody has saved yet is the worst kind of wrong. */}
            {configured && stored?.enabled ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--success)]/15 text-[var(--success)]">live</span>
            ) : configured ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--warning)]/15 text-[var(--warning)]">configured, off</span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--muted)]/15 text-[var(--muted)]">not set up</span>
            )}
            {configured && problems.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--danger)]/15 text-[var(--danger)]">
                {problems.length} issue{problems.length > 1 ? "s" : ""}
              </span>
            )}
            {dirty && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--primary)]/15 text-[var(--primary)]">
                unsaved
              </span>
            )}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5 truncate">
            {net.kind} · {net.site}
          </p>
        </div>
        <span className="text-[var(--muted)] shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-5">
          {/* ---------- 1. Landing URL ---------- */}
          <Section
            n={1}
            title="Put this URL in the campaign"
            hint={`In ${net.name}: ${net.landingUrlField}. The network replaces each macro with the real value at click time.`}
          >
            <CopyBox text={landing} onCopy={() => toast.success("Landing URL copied")} />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--muted)]">
                    <th className="py-1 pr-3 font-medium">Our parameter</th>
                    <th className="py-1 pr-3 font-medium">{net.name} macro</th>
                    <th className="py-1 font-medium">What it is</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {net.macros.map((m) => (
                    <tr key={m.ourParam}>
                      <td className="py-1.5 pr-3 font-mono whitespace-nowrap">
                        {m.ourParam}
                        {m.required && <span className="text-[var(--danger)]"> *</span>}
                      </td>
                      <td className="py-1.5 pr-3 font-mono whitespace-nowrap text-[var(--primary)]">{m.macro}</td>
                      <td className="py-1.5 text-[var(--muted)]">{m.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[var(--muted)]">
              <span className="text-[var(--foreground)]">net={net.slug}</span> is what routes the conversion back to this
              configuration, and <span className="text-[var(--foreground)]">cid</span> is the click id we echo in the
              postback. Copy the macro tokens exactly — a token the network does not recognise is passed through as
              literal text and every conversion from that campaign goes unattributed, with no error anywhere.
            </p>
          </Section>

          {/* ---------- 2. Postback URL ---------- */}
          <Section n={2} title="Postback URL" hint={`Where to find yours — ${net.dashboardPath}`}>
            <div
              className={`rounded-lg border p-3 text-xs ${
                conf.tone === "success"
                  ? "border-[var(--success)]/40 bg-[var(--success)]/10"
                  : "border-[var(--warning)]/40 bg-[var(--warning)]/10"
              }`}
            >
              <p className="font-medium">{conf.label}</p>
              <p className="text-[var(--muted)] mt-1">{conf.blurb}</p>
              <p className="text-[var(--muted)] mt-1">{net.confidenceNote}</p>
              <p className="text-[var(--muted)] mt-1">
                <span className="text-[var(--foreground)]">Credential:</span> {net.credentialNote}
              </p>
            </div>

            <label className="block text-xs space-y-1">
              <span className="text-[var(--muted)]">
                URL template — put {"{{click_id}}"} where the click id goes, {"{{payout}}"} where the value goes
              </span>
              <textarea
                value={form.postbackUrl}
                onChange={(e) => set("postbackUrl", e.target.value)}
                rows={3}
                className={inputCls}
              />
            </label>

            {problems.length > 0 && (
              <ul className="text-xs text-[var(--warning)] space-y-1 list-disc pl-4">
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}

            <details className="text-xs">
              <summary className="cursor-pointer text-[var(--muted)]">Macros you can use</summary>
              <table className="w-full mt-2">
                <tbody className="divide-y divide-[var(--border)]">
                  {TEMPLATE_MACROS.map((m) => (
                    <tr key={m.macro}>
                      <td className="py-1 pr-3 font-mono text-[var(--primary)] whitespace-nowrap align-top">{m.macro}</td>
                      <td className="py-1 text-[var(--muted)]">{m.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs space-y-1">
                <span className="text-[var(--muted)]">Method</span>
                <select
                  value={form.method}
                  onChange={(e) => set("method", e.target.value as "GET" | "POST")}
                  className={inputCls}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--muted)]">API key (write-only — blank keeps the saved one)</span>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => set("apiKey", e.target.value)}
                  placeholder={stored?.hasApiKey ? "•••••• saved" : "only if the network issues one"}
                  className={inputCls}
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--muted)]">Success text — a 2xx only counts if the body contains this</span>
                <input
                  value={form.successPattern}
                  onChange={(e) => set("successPattern", e.target.value)}
                  placeholder="blank = any 2xx counts"
                  className={inputCls}
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--muted)]">Failure text — a 2xx containing this is recorded as failed</span>
                <input
                  value={form.failurePattern}
                  onChange={(e) => set("failurePattern", e.target.value)}
                  placeholder="e.g. &quot;status&quot;:&quot;error&quot;"
                  className={inputCls}
                />
              </label>
              {form.method === "POST" && (
                <>
                  <label className="text-xs space-y-1 sm:col-span-2">
                    <span className="text-[var(--muted)]">POST body (same macros; blank sends no body)</span>
                    <textarea
                      value={form.postbackBody}
                      onChange={(e) => set("postbackBody", e.target.value)}
                      rows={2}
                      className={inputCls}
                    />
                  </label>
                  <label className="text-xs space-y-1">
                    <span className="text-[var(--muted)]">Content-Type</span>
                    <input
                      value={form.postbackContentType}
                      onChange={(e) => set("postbackContentType", e.target.value)}
                      placeholder="application/x-www-form-urlencoded"
                      className={inputCls}
                    />
                  </label>
                </>
              )}
              <label className="text-xs space-y-1">
                <span className="text-[var(--muted)]">Timeout (ms)</span>
                <input
                  type="number"
                  value={form.timeoutMs}
                  onChange={(e) => set("timeoutMs", Number(e.target.value))}
                  className={inputCls}
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--muted)]">Max attempts (retries use 15m / 1h / 6h / 24h backoff)</span>
                <input
                  type="number"
                  value={form.maxAttempts}
                  onChange={(e) => set("maxAttempts", Number(e.target.value))}
                  className={inputCls}
                />
              </label>
            </div>
          </Section>

          {/* ---------- 3. Payout ---------- */}
          <Section n={3} title="What value to send" hint={net.payoutNote}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs space-y-1">
                <span className="text-[var(--muted)]">Payout mode</span>
                <select
                  value={form.payoutMode}
                  onChange={(e) => set("payoutMode", e.target.value as PayoutMode)}
                  className={inputCls}
                >
                  <option value="none">Do not send a payout (conversion still counts)</option>
                  <option value="revenue">The order value × rate</option>
                  <option value="percent">A percentage of the order value</option>
                  <option value="fixed">A fixed number every time</option>
                </select>
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--muted)]">Currency label sent as {"{{currency}}"}</span>
                <input
                  value={form.payoutCurrency}
                  onChange={(e) => set("payoutCurrency", e.target.value)}
                  className={inputCls}
                />
              </label>
              {(form.payoutMode === "revenue" || form.payoutMode === "percent") && (
                <label className="text-xs space-y-1">
                  <span className="text-[var(--muted)]">INR → {form.payoutCurrency} rate (1 = send rupees unchanged)</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={form.fxRate}
                    onChange={(e) => set("fxRate", Number(e.target.value))}
                    className={inputCls}
                  />
                </label>
              )}
              {form.payoutMode === "percent" && (
                <label className="text-xs space-y-1">
                  <span className="text-[var(--muted)]">Percent of the order value</span>
                  <input
                    type="number"
                    value={form.payoutPercent}
                    onChange={(e) => set("payoutPercent", Number(e.target.value))}
                    className={inputCls}
                  />
                </label>
              )}
              {form.payoutMode === "fixed" && (
                <label className="text-xs space-y-1">
                  <span className="text-[var(--muted)]">Fixed value</span>
                  <input
                    type="number"
                    step="0.0001"
                    value={form.payoutFixed}
                    onChange={(e) => set("payoutFixed", Number(e.target.value))}
                    className={inputCls}
                  />
                </label>
              )}
            </div>
            <p className="text-xs text-[var(--muted)]">
              A ₹499 subscription would send <span className="text-[var(--foreground)]">{previewPayout(form)}</span>. The
              rate is a fixed number you maintain — we never call a live FX service from the conversion path.
            </p>
          </Section>

          {/* ---------- 4. Events ---------- */}
          <Section
            n={4}
            title="Which events to report"
            hint="Purchase is raised server-side from the PayU-confirmed transaction. The other three are raised by the browser and are de-duplicated per click."
          >
            <div className="space-y-2">
              {EVENT_CATALOG.map((e) => {
                const ev = form.events[e.key];
                return (
                  <div key={e.key} className="rounded-lg border border-[var(--border)] p-3">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={ev.enabled}
                        onChange={(x) => setEvent(e.key, { enabled: x.target.checked })}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{e.label}</span>
                        <span
                          className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${
                            e.trust === "server"
                              ? "bg-[var(--success)]/15 text-[var(--success)]"
                              : "bg-[var(--muted)]/15 text-[var(--muted)]"
                          }`}
                        >
                          {e.trust === "server" ? "server-verified" : "browser"}
                        </span>
                        <span className="block text-xs text-[var(--muted)] mt-0.5">{e.what}</span>
                      </span>
                    </label>
                    {ev.enabled && (
                      <div className="mt-2 ml-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {net.supportsGoal && (
                          <label className="text-xs space-y-1">
                            <span className="text-[var(--muted)]">Goal sent as {"{{goal}}"}</span>
                            <input
                              value={ev.goal}
                              onChange={(x) => setEvent(e.key, { goal: x.target.value })}
                              placeholder="blank = no goal parameter"
                              className={inputCls}
                            />
                          </label>
                        )}
                        <label className="flex items-center gap-2 text-xs self-end pb-2">
                          <input
                            type="checkbox"
                            checked={ev.sendPayout}
                            onChange={(x) => setEvent(e.key, { sendPayout: x.target.checked })}
                          />
                          <span className="text-[var(--muted)]">
                            Send the payout on this event (off drops {"{{payout}}"} and {"{{currency}}"})
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* ---------- Caveats ---------- */}
          <Section n={5} title={`What bites people on ${net.name}`}>
            <ul className="text-xs text-[var(--muted)] space-y-1.5 list-disc pl-4">
              {net.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
            {net.docsUrl && (
              <p className="text-xs">
                <a
                  href={net.docsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[var(--primary)] underline underline-offset-2"
                >
                  {net.name} documentation ↗
                </a>
              </p>
            )}
          </Section>

          {/* ---------- Actions ---------- */}
          <div className="border-t border-[var(--border)] mt-4 pt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
              <span>
                Send postbacks to {net.name}
                <span className="text-[var(--muted)]"> — off means conversions are recorded but nothing is sent</span>
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} loading={saving}>
                {configured ? "Save changes" : "Save configuration"}
              </Button>
              <Button variant="secondary" onClick={() => fire(true)} disabled={!configured}>
                Preview URL
              </Button>
              <Button variant="secondary" onClick={() => fire(false)} disabled={!configured}>
                Send test postback
              </Button>
              {configured && (
                <Button variant="secondary" onClick={remove}>
                  Delete
                </Button>
              )}
            </div>
            <label className="text-xs space-y-1 block max-w-md">
              <span className="text-[var(--muted)]">Click id to test with — blank uses a made-up one</span>
              <input
                value={testClickId}
                onChange={(e) => setTestClickId(e.target.value)}
                placeholder="paste a real click id from a recent visit"
                className={inputCls}
              />
            </label>
            <p className="text-xs text-[var(--muted)]">
              A test uses the saved configuration and ignores the switches above, so you can prove a network works
              before turning it on. &ldquo;Preview URL&rdquo; renders the URL without calling anyone.{" "}
              <span className="text-[var(--foreground)]">
                Networks that validate the click id — EvaDav, RichAds and PopCash among them — will correctly reject a
                made-up one
              </span>
              , so a test with a blank click id proves the URL and credentials, not the whole path. For an end-to-end
              check use a real click id, EvaDav&apos;s test Click ID generator, or HilltopAds&apos; Test Conversion tool.
            </p>

            {testId && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-xs space-y-2">
                {!testResult || testResult.status === "queued" ? (
                  <p className="text-[var(--muted)]">Queued — waiting for the delivery function…</p>
                ) : (
                  <>
                    <p>
                      <span className="text-[var(--muted)]">Result: </span>
                      <span
                        className={
                          testResult.status === "sent"
                            ? "text-[var(--success)]"
                            : testResult.status === "failed"
                              ? "text-[var(--danger)]"
                              : "text-[var(--warning)]"
                        }
                      >
                        {String(testResult.status)}
                        {testResult.skipReason ? ` (${String(testResult.skipReason)})` : ""}
                        {testResult.httpStatus ? ` · HTTP ${String(testResult.httpStatus)}` : ""}
                      </span>
                    </p>
                    {!!testResult.url && (
                      <code className="block bg-[var(--card)] border border-[var(--border)] rounded px-2 py-1.5 break-all">
                        {String(testResult.url)}
                      </code>
                    )}
                    {!!testResult.responseSnippet && (
                      <p className="text-[var(--muted)] break-all">
                        Response: {String(testResult.responseSnippet).slice(0, 300)}
                      </p>
                    )}
                    {!!testResult.error && <p className="text-[var(--danger)]">{String(testResult.error)}</p>}
                    <p className="text-[var(--muted)]">
                      An API key shows as <code>***</code> above — it is written into the real request but redacted
                      everywhere it is stored. And remember several of these endpoints answer 200 regardless of what you
                      send them, so confirm the conversion in {net.name}&apos;s own reporting before trusting it.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdNetworksPage() {
  const [configs, setConfigs] = useState<Record<string, StoredNet>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [siteUrl, setSiteUrl] = useState("");

  useEffect(() => {
    setSiteUrl(window.localStorage.getItem(SITE_URL_KEY) || "https://your-site.com");
  }, []);

  const onSiteUrl = useCallback((v: string) => {
    setSiteUrl(v);
    try {
      window.localStorage.setItem(SITE_URL_KEY, v);
    } catch {
      /* private mode — the URLs still render, they just aren't remembered */
    }
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db(), "adNetworks"),
      (snap) => {
        const next: Record<string, StoredNet> = {};
        snap.docs.forEach((d) => (next[d.id] = d.data() as StoredNet));
        setConfigs(next);
        setLoading(false);
      },
      (e) => {
        console.error("adNetworks:", e);
        setErr("Could not read the network configuration. Only admins can.");
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  return (
    <AdNetworksShell>
      <div className="space-y-4 max-w-4xl">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-2">
          <p className="text-sm">
            How this works: an ad click lands on{" "}
            <code className="text-[var(--primary)]">?net=&lt;network&gt;&amp;cid=&lt;their click id&gt;</code>, we keep
            that click id in a first-party cookie through the funnel, and when the visitor converts we call the network
            back server-side with it. That call is the only way their optimiser learns which zones and creatives produce
            paying subscribers.
          </p>
          <label className="text-xs space-y-1 block max-w-md">
            <span className="text-[var(--muted)]">Your site URL — used to build the landing URLs below</span>
            <Input value={siteUrl} onChange={(e) => onSiteUrl(e.target.value)} className="w-full" />
          </label>
        </div>

        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}

        {loading ? (
          <div className="py-10 flex justify-center">
            <Loader />
          </div>
        ) : (
          <div className="space-y-3">
            {AD_NETWORKS.map((n) => (
              <NetworkCard key={n.slug} net={n} stored={configs[n.slug] ?? null} siteUrl={siteUrl} />
            ))}
          </div>
        )}

        <p className="text-xs text-[var(--muted)]">
          Real conversions are only sent once you save a configuration, tick the event and switch the network on; the
          test buttons on each card ignore those switches on purpose. Every queued delivery — including the ones we
          decline to send, and why — is on the <span className="text-[var(--foreground)]">Deliveries</span> tab.
        </p>
      </div>
    </AdNetworksShell>
  );
}
