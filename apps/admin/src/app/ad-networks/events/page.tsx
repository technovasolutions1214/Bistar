"use client";
import React, { useEffect, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@bistar/firebase-config";
import { AdNetworksShell } from "@/components/ad-networks-shell";
import { AD_NETWORKS, EVENT_CATALOG, type AdEventKey } from "@/lib/ad-networks";
import { Loader, useToast } from "@bistar/ui";

/**
 * Events — what each trigger means, where it is raised, and a grid for turning
 * one event on or off across every network at once.
 *
 * The grid writes straight to `adNetworks/{slug}.events.<key>.enabled`, the
 * same field the Networks tab edits. A network with no saved configuration has
 * no cell to tick — set it up first.
 */

interface StoredNet {
  enabled?: boolean;
  postbackUrl?: string;
  events?: Partial<Record<AdEventKey, { enabled?: boolean; goal?: string }>>;
}

/**
 * RichAds rejects a postback with no `action`, and this grid can only toggle
 * `enabled` — the goal value lives on the network's card. Rather than block the
 * tick (someone may be about to go and set it), mark the cell so the failure is
 * predicted here instead of discovered in the Deliveries log.
 */
function missingGoal(net: (typeof AD_NETWORKS)[number], cfg: StoredNet | undefined, key: AdEventKey): boolean {
  if (!cfg || !net.goalRequired) return false;
  const tpl = cfg.postbackUrl ?? net.postbackTemplate;
  if (!/\{\{\s*goal\s*\}\}/.test(tpl)) return false;
  return !cfg.events?.[key]?.goal?.trim();
}

export default function EventsPage() {
  const toast = useToast();
  const [configs, setConfigs] = useState<Record<string, StoredNet>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db(), "adNetworks"),
      (snap) => {
        const next: Record<string, StoredNet> = {};
        snap.docs.forEach((d) => (next[d.id] = d.data() as StoredNet));
        setConfigs(next);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  async function toggle(slug: string, key: AdEventKey, on: boolean) {
    setBusy(`${slug}:${key}`);
    try {
      await setDoc(
        doc(db(), "adNetworks", slug),
        { events: { [key]: { enabled: on } }, updatedAt: new Date() },
        { merge: true },
      );
    } catch {
      toast.error("Could not save. Only admins can change this.");
    } finally {
      setBusy("");
    }
  }

  return (
    <AdNetworksShell>
      <div className="space-y-6 max-w-4xl">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">The four triggers</h2>
          <p className="text-sm text-[var(--muted)]">
            An ad network&apos;s optimiser learns from whatever you report back. Report the wrong thing and it buys the
            wrong traffic, so it is worth knowing exactly what each of these means.
          </p>
          <div className="space-y-3">
            {EVENT_CATALOG.map((e, i) => (
              <div key={e.key} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
                  <span className="w-5 h-5 rounded-full bg-[var(--background)] border border-[var(--border)] text-[11px] flex items-center justify-center">
                    {i + 1}
                  </span>
                  {e.label}
                  <code className="text-[11px] text-[var(--muted)]">{e.key}</code>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      e.trust === "server"
                        ? "bg-[var(--success)]/15 text-[var(--success)]"
                        : "bg-[var(--muted)]/15 text-[var(--muted)]"
                    }`}
                  >
                    {e.trust === "server" ? "server-verified" : "raised by the browser"}
                  </span>
                  {e.defaultOn && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)]">
                      on by default
                    </span>
                  )}
                </p>
                <p className="text-sm text-[var(--muted)] mt-2">{e.what}</p>
                <p className="text-xs text-[var(--muted)] mt-1">
                  <span className="text-[var(--foreground)]">Fires when:</span> {e.when}
                </p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-4 text-sm">
            <p className="font-medium">Only Purchase is trustworthy data.</p>
            <p className="text-[var(--muted)] mt-1">
              It is raised by a Cloud Function watching a transaction flip to success after PayU&apos;s hash-verified
              webhook, so a browser cannot fabricate it. The other three come from the page through
              <code className="mx-1 text-[var(--foreground)]">/api/track/ad-event</code>, which rate-limits by IP and
              allows each event once per click id — but anyone holding a click id could still raise them. Optimise
              against Purchase; use the earlier events only where a network needs more volume than your purchases
              provide.
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Which network gets which event</h2>
          <p className="text-sm text-[var(--muted)]">
            Ticking a box here is the same as ticking it inside a network&apos;s card. A network still has to be
            switched on for anything to be sent. A{" "}
            <span className="text-[var(--warning)] font-bold">!</span> marks an event that would be rejected as
            configured — hover it for why.
          </p>
          {loading ? (
            <div className="py-10 flex justify-center">
              <Loader />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--background)]/40">
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-4 py-3 font-medium">Network</th>
                    {EVENT_CATALOG.map((e) => (
                      <th key={e.key} className="px-4 py-3 font-medium text-center whitespace-nowrap">
                        {e.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 font-medium">Sending</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {AD_NETWORKS.map((n) => {
                    const cfg = configs[n.slug];
                    return (
                      <tr key={n.slug}>
                        <td className="px-4 py-3 whitespace-nowrap">{n.name}</td>
                        {EVENT_CATALOG.map((e) => (
                          <td key={e.key} className="px-4 py-3 text-center">
                            {cfg ? (
                              <span className="inline-flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={!!cfg.events?.[e.key]?.enabled}
                                  disabled={busy === `${n.slug}:${e.key}`}
                                  onChange={(x) => toggle(n.slug, e.key, x.target.checked)}
                                />
                                {missingGoal(n, cfg, e.key) && (
                                  <span
                                    title={`${n.name} rejects a call with no goal — set one for this event on its card.`}
                                    className="text-[var(--warning)] text-xs font-bold cursor-help"
                                  >
                                    !
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-[var(--muted)]">—</span>
                            )}
                          </td>
                        ))}
                        <td className="px-4 py-3">
                          {!cfg ? (
                            <span className="text-xs text-[var(--muted)]">not set up</span>
                          ) : cfg.enabled ? (
                            <span className="text-xs text-[var(--success)]">on</span>
                          ) : (
                            <span className="text-xs text-[var(--warning)]">off</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Goals, where a network has them</h2>
          <p className="text-sm text-[var(--muted)]">
            Some networks want a goal name or level alongside the conversion so they can tell a registration from a
            sale. Those values are per event and live on each network&apos;s card, because they are network-specific
            strings — PropellerAds uses numbered levels (1, 2, 3), RichAds uses{" "}
            <code className="text-[var(--foreground)]">conversion</code> /{" "}
            <code className="text-[var(--foreground)]">conversion1</code> in its{" "}
            <code className="text-[var(--foreground)]">action</code> parameter, and HilltopAds uses a free-form name
            such as <code className="text-[var(--foreground)]">reg</code> on secondary events only. AdMaven, PopAds,
            PopCash and EvaDav have no usable goal parameter, so for those pick the single event worth optimising
            against.
          </p>
        </section>
      </div>
    </AdNetworksShell>
  );
}
