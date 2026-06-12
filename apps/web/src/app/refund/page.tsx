import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund Policy - Bistar",
  description: "Refund Policy for subscriptions and purchases on Bistar.",
};

export default function RefundPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-12">
      <p className="eyebrow mb-2">Legal</p>
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Refund &amp; Cancellation Policy</h1>
      <p className="text-sm text-[var(--muted)] mb-10">
        Last updated: April 19, 2026
      </p>

      <div className="space-y-8 text-[var(--foreground)] leading-relaxed">
        <section>
          <p>
            This Refund &amp; Cancellation Policy (&ldquo;Policy&rdquo;) applies to all
            subscriptions, Plans, day-packs and any other paid purchases made on Bistar, a
            streaming service operated by <strong>Technova Solutions</strong>
            (&ldquo;Technova&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo; or &ldquo;our&rdquo;). By
            completing a purchase on Bistar, you expressly acknowledge and agree to the terms
            of this Policy. This Policy forms part of, and must be read together with, our Terms
            of Use.
          </p>
        </section>

        <section className="border-l-4 border-[var(--gold-2)] bg-[var(--card)] p-5 rounded">
          <h2 className="text-xl font-semibold mb-3">1. No Refunds &mdash; All Sales are Final</h2>
          <p>
            <strong>
              Technova operates on a strict NO-REFUND policy. Once payment for any subscription,
              Plan, day-pack, add-on or other purchase has been successfully processed, the
              transaction is final and non-refundable under any circumstances.
            </strong>
          </p>
          <p className="mt-3">
            No refunds, returns, reversals, credits, adjustments, pro-rated reimbursements,
            exchanges, substitutions, top-ups or extensions will be granted, whether in whole or
            in part, irrespective of usage or the reason for the request.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. Scenarios Not Eligible for a Refund</h2>
          <p>Without limiting the generality of the foregoing, the following are expressly not grounds for a refund:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>you changed your mind, no longer need the subscription or are dissatisfied with the Service;</li>
            <li>partial usage, non-usage or limited usage of the Plan during the purchased period;</li>
            <li>accidental, mistaken, unintended, duplicate or repeat purchases made from your account;</li>
            <li>purchases made by any person using your account, device or credentials (authorised or otherwise);</li>
            <li>specific titles, movies, series, seasons, episodes or languages being unavailable, removed, replaced, geo-restricted or not meeting your expectations;</li>
            <li>buffering, playback issues, lower-than-expected quality, subtitle/audio issues or compatibility issues with your device, browser, operating system, network or internet service provider;</li>
            <li>temporary service interruptions, scheduled maintenance, unscheduled downtime, outages or disruptions caused by third parties;</li>
            <li>suspension or termination of your account by us for breach of our Terms of Use or applicable law;</li>
            <li>loss of access resulting from lost, changed or deactivated phone numbers, email addresses or devices;</li>
            <li>chargebacks, payment reversals or disputes initiated without first contacting us and obtaining a written resolution;</li>
            <li>any force-majeure event, including but not limited to natural disasters, power failures, telecom outages, cyber-attacks or government actions;</li>
            <li>any other reason not expressly required by applicable law.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. Cancellation</h2>
          <p>
            You may cancel auto-renewal of any recurring subscription at any time from your
            account settings; cancellation prevents future charges but <strong>does not
            retroactively refund any amount already paid</strong>. Active subscriptions will
            continue to be available until the end of the period for which payment has been
            received, after which they will simply lapse. Day-based Plans expire automatically
            at the end of the purchased duration and cannot be cancelled for a refund mid-way.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. Duplicate or Erroneous Charges</h2>
          <p>
            In the rare event of a duplicate charge attributable solely to a verified technical
            error on our side (for example, the same Plan charged twice for the same account in
            the same minute), you may write to us within seven (7) days of the transaction with
            full transaction details. Upon our investigation and sole determination that the
            charge was erroneous, we may, at our absolute discretion, issue a credit to your
            Bistar account (not a monetary refund) of an equivalent value. We are not obliged
            to issue any credit and no monetary refund will be made.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. Failed Transactions</h2>
          <p>
            If an amount is debited from your account but your subscription is not activated
            within 24 hours due to a verified payment-gateway failure, the amount will be
            automatically reversed by your bank or the payment gateway as per their policies,
            typically within 5&ndash;10 business days. Such reversals are handled entirely by
            the payment gateway and the issuing bank; Technova does not process them and has no
            role, visibility or liability with respect to the timing or success of the
            reversal. You must take up any such issue directly with your bank or the payment
            gateway.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Chargebacks</h2>
          <p>
            Initiating a chargeback, payment dispute or reversal with your bank, card network or
            payment provider without first contacting us and following the process above is a
            material breach of our Terms of Use. We reserve the right to: (a) immediately and
            permanently terminate your account; (b) retain all amounts paid; (c) block you from
            future use of the Service; (d) recover from you all associated chargeback fees,
            investigation costs and legal expenses; and (e) report the dispute to credit
            bureaus, fraud databases and law-enforcement authorities.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. Price Changes &amp; Promotions</h2>
          <p>
            Plan prices, features and promotional offers may change at any time. Price changes
            will not apply retroactively to already-purchased Plans, and reductions in price
            after your purchase do not entitle you to a refund or credit of the difference.
            Promotional codes, discounts and offers are subject to their own terms and cannot
            be combined unless expressly stated.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. Statutory Rights</h2>
          <p>
            Nothing in this Policy is intended to exclude or limit any right that cannot lawfully
            be excluded or limited under applicable law, including your rights under the
            Consumer Protection Act, 2019. Where a refund is required by non-excludable law, it
            will be limited to the minimum amount and scope required by that law. To the
            fullest extent permitted, all other refund claims are expressly waived.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. How to Contact Us</h2>
          <p>
            For questions about this Policy or any payment matter, please email us at{" "}
            <a href="mailto:support@bistar.app" className="text-[var(--gold-2)] hover:text-[var(--gold-1)] hover:underline">
              support@bistar.app
            </a>
            . Please include your registered mobile number / email and the transaction
            reference. We will respond within a reasonable time, but a response does not imply
            or create any entitlement to a refund.
          </p>
        </section>
      </div>
    </div>
  );
}
