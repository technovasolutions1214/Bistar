"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { auth, db } from "@bistar/firebase-config";
import { MarketingShell } from "@/components/marketing-shell";
import { Button, Input, Loader, useToast } from "@bistar/ui";

// ---------------------------------------------------------------------------
// Pixels panel.
//
// Each pixel maps to a campaign slug; the consumer site loads the pixel whose
// slug matches ?c=<slug> and falls back to the default pixel.
//
// The "Verify" block on each card is what makes a NEWLY ADDED pixel provable
// without leaving the panel. It covers both halves of the pixel, because they
// fail independently and for different reasons:
//
//   * Server (CAPI) — "Send test event" asks the server to post a real event to
//     Meta using the pixel's stored access token, and shows Meta's reply
//     verbatim. The token lives in `pixelSecrets`, which no client can read, so
//     this has to go through an API route.
//   * Browser (fbq) — "Verify browser events" opens a short window during which
//     the consumer site reports every event it fires into `pixelEvents`, which
//     streams into the feed below. For a single page there is also
//     `?pixelDebug=1`, which shows the same events as an on-page overlay.
//
// About Test Events codes: Meta ties the code to an OPEN Test Events tab and
// rotates it. A stale code does NOT fail — Meta answers 200 and processes the
// event as real traffic, saying so only in a `messages` array. So we store the
// code with an expiry, surface every message as a warning, and never claim an
// event reached Test Events unless Meta stayed quiet about the code.
// ---------------------------------------------------------------------------

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
  testEventCode: string;
  testEventCodeExpiresAt: Date | null;
  verifyUntil: Date | null;
}

interface PixelEvent {
  id: string;
  event: string;
  source: string;
  path?: string;
  eventId?: string;
  pixelId?: string;
  reportedPixelId?: string;
  testEventCode?: string | null;
  createdAt: Date | null;
  result?: {
    ok?: boolean;
    http?: number;
    eventsReceived?: number | null;
    messages?: string[];
    error?: string | null;
    fbtraceId?: string | null;
  };
}

interface TestResult {
  ok?: boolean;
  http?: number;
  eventsReceived?: number | null;
  messages?: string[];
  landedInTestEvents?: boolean;
  error?: string | null;
  fbtraceId?: string | null;
  testEventCode?: string | null;
}

/** Events worth a one-click test; must match the API route's allow-list. */
const TEST_EVENTS = [
  "Purchase",
  "InitiateCheckout",
  "CompleteRegistration",
  "ViewContent",
  "Search",
  "PageView",
] as const;

/** How long a saved Test Events code stays live. Meta's own codes are
 *  short-lived, and an expired one must not keep flagging real purchases. */
const TEST_CODE_HOURS = 3;
/** How long the consumer site reports browser events for. Short on purpose:
 *  PageView fires on every route change, for every visitor. */
const VERIFY_MINUTES = 30;
const FEED_LIMIT = 40;

const EMPTY_FORM = { slug: "", pixelId: "", label: "", isDefault: false, accountsText: "", token: "" };

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
function toDate(v: unknown): Date | null {
  if (v && typeof v === "object" && typeof (v as Timestamp).toDate === "function") {
    return (v as Timestamp).toDate();
  }
  return null;
}
function isLive(d: Date | null): boolean {
  return !!d && d.getTime() > Date.now();
}
function untilText(d: Date | null): string {
  if (!d) return "";
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  if (mins <= 0) return "expired";
  if (mins < 60) return `${mins} min left`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
}

export default function MarketingPixelsPage() {
  const toast = useToast();
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // slug being edited, or "__new__"
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db(), "pixels"));
      setPixels(
        snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            slug: d.id,
            pixelId: (data.pixelId as string) ?? "",
            label: (data.label as string) ?? "",
            isDefault: !!data.isDefault,
            hasToken: !!data.hasToken,
            adAccounts: (data.adAccounts as AdAccount[]) ?? [],
            testEventCode: (data.testEventCode as string) ?? "",
            testEventCodeExpiresAt: toDate(data.testEventCodeExpiresAt),
            verifyUntil: toDate(data.verifyUntil),
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
      // A pixel is only useful once you have seen it fire, so drop straight
      // into its Verify block instead of making that a thing to go and find.
      setVerifyOpen(slug);
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
              <PixelCard
                key={p.slug}
                pixel={p}
                open={verifyOpen === p.slug}
                onToggle={() => setVerifyOpen(verifyOpen === p.slug ? null : p.slug)}
                onEdit={() => startEdit(p)}
                onDelete={() => remove(p.slug)}
                onChanged={load}
              />
            ))}
          </div>
        )}
      </div>
    </MarketingShell>
  );
}

/* ------------------------------------------------------------- pixel card --- */

function urlTemplate(slug: string, acct: string) {
  const a = acct || "<AD_ACCOUNT_ID>";
  return `https://<your-site>/?c=${slug}&acct=${a}&utm_source=meta&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}`;
}

function PixelCard({
  pixel: p,
  open,
  onToggle,
  onEdit,
  onDelete,
  onChanged,
}: {
  pixel: Pixel;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(p.testEventCode);
  const [event, setEvent] = useState<string>("Purchase");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const testCodeLive = isLive(p.testEventCodeExpiresAt);
  const verifying = isLive(p.verifyUntil);

  /** Live feed of everything that reached this pixel, newest first. */
  const [feed, setFeed] = useState<PixelEvent[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const q = query(
      collection(db(), "pixelEvents"),
      where("pixelSlug", "==", p.slug),
      orderBy("createdAt", "desc"),
      fsLimit(FEED_LIMIT)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setFeedError(null);
        setFeed(
          snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              event: (data.event as string) ?? "?",
              source: (data.source as string) ?? "?",
              path: data.path as string | undefined,
              eventId: data.eventId as string | undefined,
              pixelId: data.pixelId as string | undefined,
              reportedPixelId: data.reportedPixelId as string | undefined,
              testEventCode: (data.testEventCode as string | null) ?? null,
              createdAt: toDate(data.createdAt),
              result: data.result as PixelEvent["result"],
            };
          })
        );
      },
      (err) => setFeedError(err.message)
    );
    return () => unsub();
  }, [open, p.slug]);

  async function authedPost(url: string, body: unknown) {
    const u = auth().currentUser;
    if (!u) throw new Error("Sign in again.");
    const token = await u.getIdToken();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error || "Request failed");
    return json;
  }

  /** Save (or clear) the Test Events code, stamping its expiry. */
  async function saveCode(next: string) {
    setBusy(true);
    try {
      const trimmed = next.trim();
      await setDoc(
        doc(db(), "pixels", p.slug),
        trimmed
          ? {
              testEventCode: trimmed,
              testEventCodeExpiresAt: Timestamp.fromDate(
                new Date(Date.now() + TEST_CODE_HOURS * 60 * 60 * 1000)
              ),
              updatedAt: new Date(),
            }
          : {
              testEventCode: deleteField(),
              testEventCodeExpiresAt: deleteField(),
              updatedAt: new Date(),
            },
        { merge: true }
      );
      toast.success(trimmed ? `Test code saved for ${TEST_CODE_HOURS}h` : "Test code cleared");
      onChanged();
    } catch {
      toast.error("Failed to save the test code");
    } finally {
      setBusy(false);
    }
  }

  /** Open or close the window in which the site reports browser events. */
  async function setVerifyWindow(on: boolean) {
    setBusy(true);
    try {
      await setDoc(
        doc(db(), "pixels", p.slug),
        on
          ? {
              verifyUntil: Timestamp.fromDate(new Date(Date.now() + VERIFY_MINUTES * 60 * 1000)),
              updatedAt: new Date(),
            }
          : { verifyUntil: deleteField(), updatedAt: new Date() },
        { merge: true }
      );
      toast.success(on ? `Logging browser events for ${VERIFY_MINUTES} min` : "Stopped logging browser events");
      onChanged();
    } catch {
      toast.error("Failed to change verify mode");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    // No code means the event is indistinguishable from real traffic. Say so
    // plainly rather than quietly polluting reporting — this exact mistake is
    // why the warning exists.
    if (!code.trim()) {
      const go = window.confirm(
        "No Test Events code.\n\nThe event will be sent as REAL traffic and will show up in reporting as a genuine conversion.\n\nTo keep it out of reporting, open Events Manager → Test Events, copy the TEST… code shown there, paste it here, then send.\n\nSend as real traffic anyway?"
      );
      if (!go) return;
    }
    setSending(true);
    setResult(null);
    try {
      const json = (await authedPost("/api/admin/pixels/test", {
        slug: p.slug,
        event,
        testEventCode: code.trim() || undefined,
        sourceUrl: "https://bistar.app/",
      })) as TestResult;
      setResult(json);
      if (json.ok) toast.success(`Meta received the ${event} event`);
      else toast.error("Meta rejected the event");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setSending(false);
    }
  }

  const debugUrl = useMemo(() => `https://bistar.app/?c=${p.slug}&pixelDebug=1`, [p.slug]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
            {p.label || p.slug}
            {p.isDefault && <span className="text-xs text-[var(--primary)]">default</span>}
            {!p.hasToken && <span className="text-xs text-[var(--danger)]">no CAPI token</span>}
            {testCodeLive && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--primary)]/15 text-[var(--primary)]">
                test mode · {untilText(p.testEventCodeExpiresAt)}
              </span>
            )}
            {verifying && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--success)]/15 text-[var(--success)]">
                logging browser events · {untilText(p.verifyUntil)}
              </span>
            )}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5 font-mono truncate">
            ?c={p.slug} · pixel {p.pixelId} · {p.adAccounts.length} account(s)
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant={open ? "primary" : "secondary"} size="sm" onClick={onToggle}>
            {open ? "Hide" : "Verify"}
          </Button>
          <Button variant="secondary" size="sm" onClick={onEdit}>Edit</Button>
          <Button variant="secondary" size="sm" onClick={onDelete}>Delete</Button>
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

      {open && (
        <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-5">
          {/* ---------------------------------------------- server (CAPI) --- */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">1 · Server events (Conversions API)</h3>
            <p className="text-xs text-[var(--muted)]">
              Sends a real event to Meta with this pixel&apos;s stored access token — the same call a
              confirmed purchase makes. Paste the code from <strong>Events Manager → Test Events</strong>{" "}
              to keep it out of reporting; Meta rotates that code and only honours it while the tab is open.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm space-y-1">
                <span className="text-[var(--muted)] text-xs">Test Events code</span>
                <Input
                  value={code}
                  placeholder="TEST12345"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
                  className="w-40 font-mono"
                />
              </label>
              <label className="text-sm space-y-1">
                <span className="text-[var(--muted)] text-xs">Event</span>
                <select
                  value={event}
                  onChange={(e) => setEvent(e.target.value)}
                  className="block bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
                >
                  {TEST_EVENTS.map((ev) => (
                    <option key={ev} value={ev}>{ev}</option>
                  ))}
                </select>
              </label>
              <Button size="sm" loading={sending} onClick={sendTest} disabled={!p.hasToken}>
                Send test event
              </Button>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => saveCode(code)}>
                {code.trim() ? `Apply to real purchases (${TEST_CODE_HOURS}h)` : "Clear saved code"}
              </Button>
            </div>
            {testCodeLive && (
              <p className="text-xs text-[var(--primary)]">
                Saved code <code>{p.testEventCode}</code> is applied to real purchases too — they will
                appear in Test Events and <strong>not</strong> in reporting until it expires
                ({untilText(p.testEventCodeExpiresAt)}).
              </p>
            )}
            {!p.hasToken && (
              <p className="text-xs text-[var(--danger)]">
                Add a CAPI access token on this pixel first — without one no server event can be sent.
              </p>
            )}
            {result && <TestResultBox result={result} event={event} />}
          </section>

          {/* -------------------------------------------- browser (fbq) --- */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">2 · Browser events (pixel on the site)</h3>
            <p className="text-xs text-[var(--muted)]">
              Opens a {VERIFY_MINUTES}-minute window in which the site reports every pixel event it fires
              into the feed below. Browse the site (or open the debug link) while it is on.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" loading={busy} onClick={() => setVerifyWindow(!verifying)}>
                {verifying ? "Stop logging" : `Verify browser events (${VERIFY_MINUTES} min)`}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(debugUrl);
                  toast.success("Debug link copied");
                }}
              >
                Copy debug link
              </Button>
              <code className="text-[11px] text-[var(--muted)] truncate">{debugUrl}</code>
            </div>
            <p className="text-xs text-[var(--muted)]">
              The debug link shows an on-page list of every event as it fires — no extension needed, and it
              works on a phone.
            </p>
          </section>

          {/* -------------------------------------------------- the feed --- */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">
              Events that reached this pixel{" "}
              <span className="text-xs font-normal text-[var(--muted)]">(live)</span>
            </h3>
            {feedError ? (
              <p className="text-xs text-[var(--danger)]">Could not read the feed: {feedError}</p>
            ) : feed.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">
                Nothing yet. Send a test event above, or turn on browser logging and load the site.
              </p>
            ) : (
              <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                {feed.map((e) => (
                  <FeedRow key={e.id} entry={e} expectedPixelId={p.pixelId} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ sub-widgets --- */

function TestResultBox({ result, event }: { result: TestResult; event: string }) {
  const warn = (result.messages ?? []).length > 0;
  const tone = !result.ok
    ? "border-[var(--danger)] text-[var(--danger)]"
    : warn
      ? "border-[var(--primary)] text-[var(--primary)]"
      : "border-[var(--success)] text-[var(--success)]";
  return (
    <div className={`rounded-lg border ${tone} bg-[var(--background)] p-3 text-xs space-y-1`}>
      <p className="font-medium">
        {result.ok
          ? `Meta accepted the ${event} event — events_received: ${result.eventsReceived ?? "?"}`
          : `Meta rejected the ${event} event (HTTP ${result.http ?? "?"})`}
      </p>
      {result.error && <p>Error: {result.error}</p>}
      {(result.messages ?? []).map((m, i) => (
        <p key={i}>⚠ {m}</p>
      ))}
      {result.ok && (
        <p className="text-[var(--muted)]">
          {result.landedInTestEvents
            ? `Flagged as a test event (${result.testEventCode}) — check Events Manager → Test Events.`
            : "Processed as REAL traffic — it will appear in normal reporting, not in Test Events."}
        </p>
      )}
      {result.fbtraceId && <p className="text-[var(--muted)] font-mono">fbtrace_id: {result.fbtraceId}</p>}
    </div>
  );
}

function FeedRow({ entry: e, expectedPixelId }: { entry: PixelEvent; expectedPixelId: string }) {
  const failed = e.result ? e.result.ok === false : false;
  const warn = (e.result?.messages ?? []).length > 0;
  // The id the browser actually initialised, when it disagrees with the config.
  // A pixel firing under the wrong id looks perfectly healthy from the site and
  // produces nothing in the Events Manager you are staring at.
  const mismatch =
    e.source === "browser" && !!e.reportedPixelId && e.reportedPixelId !== expectedPixelId;

  return (
    <div className="px-3 py-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={failed ? "text-[var(--danger)] font-medium" : "font-medium"}>{e.event}</span>
        <span className="px-1.5 py-0.5 rounded bg-[var(--background)] border border-[var(--border)] text-[10px] text-[var(--muted)]">
          {e.source}
        </span>
        {e.testEventCode && (
          <span className="text-[10px] text-[var(--primary)]">test · {e.testEventCode}</span>
        )}
        {failed && <span className="text-[var(--danger)]">failed</span>}
        {warn && <span className="text-[var(--primary)]">warning</span>}
        <span className="text-[var(--muted)] ml-auto">
          {e.createdAt ? e.createdAt.toLocaleString() : ""}
        </span>
      </div>
      {e.path && <p className="text-[var(--muted)] mt-0.5 font-mono truncate">{e.path}</p>}
      {mismatch && (
        <p className="text-[var(--danger)] mt-0.5">
          Fired under pixel {e.reportedPixelId}, but this slug is configured as {expectedPixelId}.
        </p>
      )}
      {e.result?.error && <p className="text-[var(--danger)] mt-0.5">{e.result.error}</p>}
      {(e.result?.messages ?? []).map((m, i) => (
        <p key={i} className="text-[var(--primary)] mt-0.5">⚠ {m}</p>
      ))}
    </div>
  );
}
