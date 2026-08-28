"use client";
import React from "react";
import { AdNetworksShell } from "@/components/ad-networks-shell";
import { AD_NETWORKS, TEMPLATE_MACROS } from "@/lib/ad-networks";

/**
 * How it works — the operational manual for this panel.
 *
 * Written for whoever has to debug a postback at 2am: what the pipeline does,
 * what every stored field means, which failure looks like what, and the exact
 * order to check things in when a network says it sees no conversions.
 */

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold mt-8 first:mt-0">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--muted)] mt-2">{children}</p>;
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 mt-3">{children}</div>;
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="text-[var(--primary)] text-[13px]">{children}</code>;
}

/** Landing-URL parameters we read. Same list the web app captures. */
const CAPTURE = [
  { p: "net", req: true, what: "Which network config to use. Must equal a network's slug exactly." },
  { p: "cid", req: true, what: "The network's click id. Also accepted as click_id, clickid, subid, sub_id or visitor_id." },
  { p: "zone", req: false, what: "Zone / site / source id. Also accepted as zoneid, zone_id, site_id." },
  { p: "camp", req: false, what: "The network's campaign id. Also accepted as campaign." },
  { p: "cre", req: false, what: "Creative / banner id. Also accepted as creative, banner_id." },
  { p: "cost", req: false, what: "What the click cost you. Also accepted as bid, price." },
];

const STATUSES = [
  { s: "queued", what: "Written and waiting for the delivery function. Should last a second or two." },
  { s: "sending", what: "Claimed by the delivery function and in flight. A row stuck here means the invocation died mid-call; the sweeper re-queues it after 15 minutes." },
  { s: "sent", what: "A 2xx came back and it passed whatever success/failure text you configured." },
  { s: "failed", what: "Non-2xx, a network error, a timeout, an unsafe URL, or the body matched your failure text. Transient failures are retried automatically." },
  { s: "skipped", what: "We deliberately did not send. The row carries the reason — a preview, a disabled network or event, a missing URL, or a ?net= that matches no configuration." },
];

export default function ReferencePage() {
  return (
    <AdNetworksShell>
      <div className="max-w-3xl pb-10">
        <H>What this panel does</H>
        <P>
          We buy traffic from seven ad networks. Each of them hands the visitor a <em>click id</em> and substitutes it
          into our landing URL. If we call that network back with the same click id when the visitor pays, their
          optimiser learns which zones, creatives and countries produce paying subscribers — and starts buying more of
          them. If we never call back, every click looks equally worthless to them and the campaign never improves.
        </P>
        <P>
          That callback is the server-to-server (S2S) postback. This panel configures it per network, decides which of
          our events count as a conversion, and records every delivery.
        </P>

        <H>The pipeline</H>
        <Card>
          <pre className="text-[11px] leading-5 overflow-x-auto text-[var(--muted)]">{`  ad click
     │  https://site/?net=propellerads&cid=\${SUBID}&zone={zoneid}
     ▼
  landing page ── captures the click id into the first-party nf_attr cookie
     │
     ├─ browser events ──▶ POST /api/track/ad-event ──┐
     │  (landing, registration, initiate_checkout)     │
     │                                                 │
     ▼                                                 │
  checkout ── POST /api/checkout/attribution           │
     │        writes adAttributions/{txnid}            │
     ▼                                                 │
  PayU webhook ── transaction flips to success         │
     │                                                 │
     ▼                                                 ▼
  onPurchaseSendAdPostbacks ────────────▶  adPostbacks/{id}  ◀──── admin test / retry
                                                 │  status: queued
                                                 ▼
                                        onAdPostbackQueued
                  claim (queued→sending) → render → safety-check → HTTP → record
                                                 │
                                     sent ───────┴─────── failed
                                                            │
                                                  retryAdPostbacks (every 30m)
                                                  re-queues, 15m / 1h / 6h / 24h
                                                  + rescues rows stranded in
                                                    queued / sending by a crash`}</pre>
        </Card>
        <P>
          Every source funnels through one queue and one delivery function, so retries, logging, secret redaction and
          URL safety checks exist in exactly one place and behave identically no matter what raised the conversion. The
          claim step matters: Firestore triggers are at-least-once, and without it a redelivered event would send the
          same conversion twice.
        </P>

        <H>What we read off the landing URL</H>
        <P>
          The Networks tab generates the exact URL for each network with its own macro tokens already in place. These
          are the parameters it builds:
        </P>
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="py-2 pr-3 font-medium">Parameter</th>
                <th className="py-2 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {CAPTURE.map((c) => (
                <tr key={c.p}>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap align-top">
                    <Code>{c.p}</Code>
                    {c.req && <span className="text-[var(--danger)]"> *</span>}
                  </td>
                  <td className="py-2 text-[var(--muted)] text-[13px]">{c.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <P>
          The click is stored in one cookie shared with Meta ads attribution, and a fresh paid click from either source
          replaces the whole record. That is deliberate: it makes it impossible to postback an ad-network click id for a
          conversion that actually came from a later Meta click. The cookie lasts 30 days.
        </P>

        <H>Macros in a postback URL</H>
        <P>
          Our macros use <Code>{"{{double braces}}"}</Code>. That is not cosmetic: several networks&apos; own macros are{" "}
          <Code>{"${SUBID}"}</Code>, <Code>{"{CLICKID}"}</Code> or <Code>{"[clickid]"}</Code>, and a single-brace syntax
          here would eat them. Anything we do not recognise is left in the URL untouched and flagged on the delivery
          row, so a typo shows up rather than silently sending an empty value.
        </P>
        <Card>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-[var(--border)]">
              {TEMPLATE_MACROS.map((m) => (
                <tr key={m.macro}>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap align-top">
                    <Code>{m.macro}</Code>
                  </td>
                  <td className="py-2 text-[var(--muted)] text-[13px]">{m.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <P>
          One rule worth knowing: a query parameter whose <em>entire</em> value is a macro that resolves to nothing is
          removed from the URL. So an event with the payout switched off sends no <Code>payout=</Code> at all rather
          than an empty one, which several networks reject. <Code>{"{{currency}}"}</Code> empties out alongside{" "}
          <Code>{"{{payout}}"}</Code>, since a currency with no amount beside it means nothing.
        </P>

        <H>Payout and currency</H>
        <P>
          This is the setting most likely to cost you money. Our prices are in INR; PopAds and AdMaven document that
          they read the number as US dollars, and RichAds, EvaDav and PopCash almost certainly do too. Sending ₹499 to
          a network that reads dollars reports a $499 conversion — roughly 85× reality — and their bidding algorithm
          will chase it.
        </P>
        <P>
          So payout starts switched off on every network. When you turn it on, set the currency you want to report in
          and an INR→currency rate, and check the live preview under the setting. The rate is a number you maintain by
          hand: a live FX lookup in the conversion path is one more thing that can fail at the worst moment.
        </P>

        <H>Reading the Deliveries tab</H>
        <Card>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-[var(--border)]">
              {STATUSES.map((s) => (
                <tr key={s.s}>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap align-top">
                    <Code>{s.s}</Code>
                  </td>
                  <td className="py-2 text-[var(--muted)] text-[13px]">{s.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <P>
          A 2xx does not always mean accepted. AdMaven returns 200 with a 1×1 GIF for any input at all; EvaDav returns
          200 with <Code>{'{"status":"error"}'}</Code> for a bad click id; RichAds returns 200 with{" "}
          <Code>Required url parameters are not present</Code>. That is what the success-text and failure-text fields
          on each network are for, and why the last word always belongs to the network&apos;s own reporting.
        </P>

        <H>When a network says it sees no conversions</H>
        <Card>
          <ol className="text-sm text-[var(--muted)] space-y-2 list-decimal pl-5">
            <li>
              <span className="text-[var(--foreground)]">Open Deliveries and filter to that network.</span> No rows at
              all means we never even queued a postback — the problem is upstream, in capture.
            </li>
            <li>
              <span className="text-[var(--foreground)]">A purchase row marked &ldquo;unknown-network&rdquo;</span>{" "}
              means traffic is arriving with a <Code>?net=</Code> value that matches no configuration here. Check the
              landing URL in that campaign for a typo. (Pre-purchase browser events are dropped at the API before a row
              is written, so they will not show up this way — they must not, or an unauthenticated caller could fill the
              log with invented network names.)
            </li>
            <li>
              <span className="text-[var(--foreground)]">Look at the click id on a row.</span> If it reads literally{" "}
              <Code>{"${SUBID}"}</Code> or <Code>[clickid]</Code>, the network did not recognise the macro you put in
              the landing URL. Copy the token from the macro list the network shows in its own campaign editor — those
              lists differ by ad format and are the only authoritative source.
            </li>
            <li>
              <span className="text-[var(--foreground)]">No rows and no click ids anywhere</span> means the landing URL
              is missing our parameters entirely, or the visitor reached the site by another route.
            </li>
            <li>
              <span className="text-[var(--foreground)]">Rows marked sent, but the network still shows nothing.</span>{" "}
              Open the row, copy the URL and check it against the one your dashboard issued: an account id typed by hand
              instead of copied is the usual culprit, and most of these endpoints accept a wrong account id with a
              cheerful 200.
            </li>
            <li>
              <span className="text-[var(--foreground)]">Check the clock.</span> PropellerAds can take 24 hours to show
              a conversion. PopAds discards a postback more than 48 hours after the click — a subscription bought a week
              after the click can never attribute there.
            </li>
          </ol>
        </Card>

        <H>Duplicates and retries</H>
        <P>
          A purchase can only ever queue one postback per network: the row id is derived from the transaction id, and it
          is created with a create-only write, so PayU&apos;s duplicate webhook delivery and any re-run of the trigger
          are both no-ops. Browser events are keyed on (network, event, click id) the same way, so a click can raise
          each event once and no more.
        </P>
        <P>
          A failure that looks transient — a timeout, a network error, a 5xx or a 429 — is retried three times inside
          the same invocation, then re-queued by a sweeper after 15 minutes, an hour, six hours and a day, up to the
          attempt limit on each network. A 4xx is not retried, because repeating a malformed request only burns quota.
          The same sweeper rescues deliveries stranded in <Code>queued</Code> or <Code>sending</Code> by an invocation
          that died, so a confirmed purchase cannot be lost just because a function crashed.
          Every retry carries the original <Code>{"{{conversion_id}}"}</Code>, so a network that de-duplicates on it
          counts one conversion however many times we tried.
        </P>

        <H>Who can see this</H>
        <P>
          Admins only, at four layers: the sidebar entry is in the admin-only list, the dashboard layout redirects a
          marketing-only account away from every non-marketing route, this panel checks the role itself, and the
          Firestore rules on <Code>adNetworks</Code>, <Code>adNetworkSecrets</Code>, <Code>adAttributions</Code> and{" "}
          <Code>adPostbacks</Code> all require admin. The last one is what makes a hand-typed URL useless to the
          marketing role.
        </P>
        <P>
          API keys are write-only: they are saved to a collection with reads denied to every client, read back only by
          the delivery function, and replaced with <Code>***</Code> in every logged URL. Postback URLs themselves are
          credentials for most of these networks — the account id in them is often the only thing authenticating the
          call — which is why the whole panel is admin-gated rather than just the key field.
        </P>

        <H>Before any of this works</H>
        <Card>
          <ul className="text-sm text-[var(--muted)] space-y-2 list-disc pl-5">
            <li>
              The Cloud Functions <Code>onAdPostbackQueued</Code>, <Code>onPurchaseSendAdPostbacks</Code> and{" "}
              <Code>retryAdPostbacks</Code> must be deployed. Until they are, rows will queue and never move off{" "}
              <Code>queued</Code>.
            </li>
            <li>
              The Firestore rules and indexes must be deployed — the retry sweeper needs the{" "}
              <Code>adPostbacks</Code> composite index.
            </li>
            <li>
              Delivery rows carry an <Code>expiresAt</Code> 60 days out. Turn on a Firestore TTL policy for that field
              if you want them cleaned up automatically.
            </li>
          </ul>
        </Card>

        <H>The seven networks at a glance</H>
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="py-2 pr-3 font-medium">Network</th>
                <th className="py-2 pr-3 font-medium">Click-id macro</th>
                <th className="py-2 pr-3 font-medium">Goals</th>
                <th className="py-2 font-medium">Postback URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {AD_NETWORKS.map((n) => (
                <tr key={n.slug}>
                  <td className="py-2 pr-3 whitespace-nowrap align-top">{n.name}</td>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap align-top text-[var(--primary)] text-[12px]">
                    {n.macros.find((m) => m.required)?.macro}
                  </td>
                  <td className="py-2 pr-3 align-top text-[var(--muted)] text-[12px]">
                    {n.supportsGoal ? "yes" : "no"}
                  </td>
                  <td className="py-2 align-top text-[var(--muted)] text-[12px]">
                    {n.templateConfidence === "confirmed"
                      ? "universal endpoint"
                      : n.templateConfidence === "verify"
                        ? "no account id, but confirm the host"
                        : "issued per account — copy yours"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <P>
          Every macro token in this panel was checked against the network&apos;s own documentation and corroborated
          against independent tracker integration guides. Where the two disagreed, or where only third-party sources
          existed, the network&apos;s card says so rather than presenting a guess as fact — because a wrong postback URL
          fails silently and costs real money.
        </P>
      </div>
    </AdNetworksShell>
  );
}
