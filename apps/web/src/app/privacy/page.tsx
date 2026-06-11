import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - Bistar",
  description: "How Bistar collects, uses and protects your information.",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-[var(--muted)] mb-10">
        Last updated: April 19, 2026
      </p>

      <div className="space-y-8 text-[var(--foreground)] leading-relaxed">
        <section>
          <p>
            This Privacy Policy (&ldquo;Policy&rdquo;) describes how{" "}
            <strong>Technova Solutions</strong> (&ldquo;Technova&rdquo;, &ldquo;we&rdquo;,
            &ldquo;us&rdquo;, or &ldquo;our&rdquo;), operator of the Bistar streaming service
            (the &ldquo;Service&rdquo;), collects, uses, discloses, retains and protects
            information that relates to you when you access or use the Service. By using the
            Service you consent to the practices described in this Policy. This Policy is
            published in accordance with the Information Technology Act, 2000, the Information
            Technology (Reasonable Security Practices and Procedures and Sensitive Personal
            Data or Information) Rules, 2011, and the Digital Personal Data Protection Act,
            2023 (to the extent applicable).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">1. Information We Collect</h2>
          <p>We collect the following categories of information:</p>
          <ul className="list-disc pl-6 mt-3 space-y-2">
            <li>
              <strong>Account data</strong>: name, email address, mobile number, profile image,
              password hashes and authentication tokens, created when you sign up via Google
              Sign-in or phone OTP.
            </li>
            <li>
              <strong>Subscription &amp; billing data</strong>: Plans purchased, purchase
              history, transaction IDs and payment status. We do <em>not</em> store full card
              numbers, CVVs, UPI PINs or bank credentials; these are handled directly by our
              payment gateway (PayU or successor).
            </li>
            <li>
              <strong>Usage &amp; viewing data</strong>: the titles you watch, watch duration,
              play/pause events, search queries, ratings, watchlist, preferences, recommendation
              interactions and session information.
            </li>
            <li>
              <strong>Device &amp; technical data</strong>: IP address, device type, operating
              system, browser, screen resolution, device identifiers, language, time zone,
              referring URLs, crash logs and approximate location derived from IP.
            </li>
            <li>
              <strong>Communication data</strong>: one-time passwords, verification codes,
              delivery receipts, support tickets and any information you provide when
              contacting us.
            </li>
            <li>
              <strong>Cookies &amp; similar technologies</strong>: cookies, local storage,
              pixels, SDK identifiers and analytics tags used to operate the Service, remember
              preferences, maintain sessions and measure performance.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>create and manage your account and authenticate you;</li>
            <li>process payments, activate Plans and maintain transaction records;</li>
            <li>deliver, personalise, recommend and improve the Service and its content;</li>
            <li>enforce our Terms of Use, detect fraud, abuse, piracy and security incidents;</li>
            <li>send service-related messages (OTP, account alerts, transaction receipts) and, with your consent where required, marketing communications;</li>
            <li>perform analytics, aggregate reporting and research;</li>
            <li>comply with applicable laws, regulations and lawful government requests.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. Legal Bases</h2>
          <p>
            We process your information on one or more of the following bases: performance of a
            contract with you, your consent, our legitimate business interests (including fraud
            prevention, security and service improvement) and compliance with legal obligations.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. Sharing &amp; Disclosure</h2>
          <p>
            We do not sell your personal information. We may share it with the following
            categories of recipients, each of which is subject to confidentiality obligations or
            their own published privacy policies:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-2">
            <li>
              <strong>Service providers &amp; processors</strong> who support the Service on our
              behalf, including cloud hosting (Google Firebase, Google Cloud), content delivery
              (Cloudflare), payment processing (PayU), SMS/OTP (MSG91), email, analytics,
              customer-support and anti-fraud providers.
            </li>
            <li>
              <strong>Content partners &amp; licensors</strong>, on an aggregated and
              de-identified basis, for royalty reporting and audit purposes.
            </li>
            <li>
              <strong>Law-enforcement, regulators and courts</strong> where required by law,
              legal process, enforceable governmental request or to protect the rights, property
              or safety of Technova, its users or the public.
            </li>
            <li>
              <strong>Successors</strong> in the event of a merger, acquisition, restructuring,
              insolvency or sale of all or part of our business or assets.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. Cookies &amp; Tracking</h2>
          <p>
            We and our service providers use cookies and similar technologies to keep you signed
            in, remember preferences, analyse traffic and measure the effectiveness of
            communications. You can control cookies through your browser settings; however,
            disabling cookies may prevent the Service from functioning correctly (for example,
            you may be unable to sign in or play video). Your continued use of the Service with
            cookies enabled constitutes consent to their use.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Data Retention</h2>
          <p>
            We retain your information for as long as your account is active, as long as needed
            to provide the Service and for a reasonable period thereafter to comply with legal,
            tax, accounting, audit, fraud-prevention, dispute-resolution and contractual
            requirements. De-identified or aggregated data may be retained indefinitely.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. Your Rights</h2>
          <p>
            Subject to applicable law, you may have the right to access, correct, update or
            erase your personal data, to withdraw consent, to object to or restrict certain
            processing, and to port your data. You can exercise most of these rights directly
            through your account settings; otherwise, you may contact us at the address below.
            We may require verification of your identity before acting on any request. Certain
            information must be retained to provide the Service or to comply with law, and such
            requests may be denied to that extent.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. Security</h2>
          <p>
            We maintain reasonable administrative, technical and physical safeguards designed to
            protect your information, including encryption in transit, access controls and
            regular security reviews. However, no method of transmission or storage is one
            hundred per cent secure. To the fullest extent permitted by law, Technova disclaims
            all liability for any unauthorised access to, disclosure of, loss of or damage to
            your information resulting from events outside our reasonable control, including
            cyber-attacks, security breaches at third parties, credential compromise at your
            end, device theft or any other circumstance not attributable to our gross
            negligence.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. Children</h2>
          <p>
            The Service is not directed to, and we do not knowingly collect information from,
            persons under the age of eighteen (18). If you believe a minor has provided us
            personal information, please contact us and we will take reasonable steps to delete
            it. Parents and guardians are responsible for monitoring and supervising the use of
            the Service by minors in their care.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">10. International Transfers</h2>
          <p>
            Your information may be stored and processed in India and in other countries where
            our service providers operate. Where such transfers take place, we take reasonable
            steps to ensure an adequate level of protection consistent with this Policy and
            applicable law.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">11. Third-Party Links &amp; Services</h2>
          <p>
            The Service may contain links to, or integrations with, third-party websites,
            applications and services. We are not responsible for the privacy practices or
            content of any third party. Your interactions with such third parties are governed
            by their own policies. We encourage you to read them.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">12. Changes to this Policy</h2>
          <p>
            We may update this Policy from time to time. The &ldquo;Last updated&rdquo; date at
            the top indicates when it was last revised. Material changes will be communicated
            through the Service or by other reasonable means. Your continued use of the Service
            after the effective date constitutes your acceptance of the revised Policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">13. Grievance Officer &amp; Contact</h2>
          <p>
            In accordance with the Information Technology Act, 2000 and rules made thereunder,
            the name and contact details of the Grievance Officer are provided below. You may
            write to us with any questions, complaints or requests regarding this Policy or
            your personal data:
          </p>
          <div className="mt-3 p-4 bg-[var(--card)] rounded border border-[var(--border)]">
            <p><strong>Technova Solutions</strong></p>
            <p>Attn: Grievance Officer &mdash; Bistar</p>
            <p>
              Email:{" "}
              <a href="mailto:grievance@bistar.app" className="text-[var(--primary)] hover:underline">
                grievance@bistar.app
              </a>
            </p>
            <p>
              Support:{" "}
              <a href="mailto:support@bistar.app" className="text-[var(--primary)] hover:underline">
                support@bistar.app
              </a>
            </p>
          </div>
          <p className="mt-3 text-sm text-[var(--muted)]">
            We endeavour to acknowledge grievances within forty-eight (48) hours and resolve
            them within one (1) month of receipt, in accordance with applicable law.
          </p>
        </section>
      </div>
    </div>
  );
}
