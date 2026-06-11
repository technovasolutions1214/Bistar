import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use - Bistar",
  description: "Terms of Use governing your access to and use of Bistar.",
};

export default function TermsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-12">
      <h1 className="text-3xl sm:text-4xl font-bold mb-2">Terms of Use</h1>
      <p className="text-sm text-[var(--muted)] mb-10">
        Last updated: April 19, 2026
      </p>

      <div className="space-y-8 text-[var(--foreground)] leading-relaxed">
        <section>
          <p>
            These Terms of Use (&ldquo;Terms&rdquo;) form a legally binding agreement between
            you (&ldquo;you&rdquo;, &ldquo;user&rdquo; or &ldquo;subscriber&rdquo;) and{" "}
            <strong>Technova Solutions</strong> (&ldquo;Technova&rdquo;, &ldquo;Company&rdquo;,
            &ldquo;we&rdquo;, &ldquo;us&rdquo; or &ldquo;our&rdquo;), the operator of the Bistar
            streaming service, website, applications and related properties (collectively, the
            &ldquo;Service&rdquo;). By accessing, browsing, registering for, subscribing to or
            otherwise using the Service in any manner, you acknowledge that you have read,
            understood and irrevocably agree to be bound by these Terms, our Privacy Policy and
            our Refund Policy, each of which is incorporated herein by reference. If you do not
            agree, you must immediately cease all use of the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">1. Eligibility</h2>
          <p>
            The Service is intended solely for users who are eighteen (18) years of age or older
            and who are competent to enter into a binding contract under the Indian Contract Act,
            1872. By using the Service you represent and warrant that you meet these requirements,
            that all information you provide is true, accurate, current and complete, and that
            your use of the Service does not violate any applicable law or regulation. We may
            refuse, suspend or terminate service to any person at our sole discretion, without
            notice and without liability.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. Account &amp; Security</h2>
          <p>
            You are solely responsible for maintaining the confidentiality of your account
            credentials, one-time passwords, devices and any activity that occurs under your
            account, whether authorised or not. You agree to notify us immediately of any
            unauthorised use. We are not liable for any loss or damage arising from your failure
            to safeguard your account, for SIM-swap, phishing, device compromise, credential
            sharing or any unauthorised access, regardless of cause.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. Subscriptions &amp; Billing</h2>
          <p>
            Access to premium content is available through day-based subscription packages
            (&ldquo;Plans&rdquo;). Plan prices, durations, features and entitlements are displayed
            at the time of purchase and may be changed at any time without prior notice. All
            payments are processed through third-party payment gateways and are subject to their
            terms. You authorise us (and our payment processors) to charge the full amount at the
            time of purchase. All amounts are inclusive of applicable taxes unless stated
            otherwise. Subscriptions activate immediately upon successful payment and expire
            automatically at the end of the purchased period. We do not offer free trials, grace
            periods or extensions unless expressly stated.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. No Refunds</h2>
          <p>
            All sales are final. Once a Plan is purchased and payment is received, no refunds,
            returns, credits, chargebacks, cancellations, pro-rated reimbursements or exchanges
            of any kind will be issued, under any circumstances. This includes, without
            limitation, cases of partial usage, non-usage, dissatisfaction, technical issues,
            service interruption, content removal, device incompatibility, accidental purchases,
            duplicate purchases, loss of access, account termination or any other reason. Please
            review our <a href="/refund" className="text-[var(--primary)] hover:underline">Refund
            Policy</a> before subscribing.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. Licence to Use Content</h2>
          <p>
            Subject to these Terms and your active subscription, Technova grants you a limited,
            personal, non-exclusive, non-transferable, non-sublicensable and revocable licence to
            stream content made available on the Service for your private, non-commercial
            viewing only. All right, title and interest in the Service and all content (including
            video, audio, images, graphics, text, data, software, trademarks, logos and
            underlying code) are and shall remain the exclusive property of Technova, its
            licensors and content partners. No other rights are granted, whether by implication,
            estoppel or otherwise.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Prohibited Conduct</h2>
          <p>You agree not to, and not to permit any third party to:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>copy, record, download, reproduce, distribute, publicly display, perform or broadcast any content;</li>
            <li>circumvent, disable, tamper with or attempt to defeat any digital rights management, encryption, security or access-control measure;</li>
            <li>reverse-engineer, decompile, disassemble or derive the source code of any part of the Service;</li>
            <li>use automated tools, bots, scrapers, crawlers or any means to access, harvest or index the Service;</li>
            <li>share, resell, rent, lease, sublicense or otherwise commercialise your account or access;</li>
            <li>use the Service for any unlawful, infringing, defamatory, obscene, harmful, fraudulent or abusive purpose;</li>
            <li>upload or transmit any virus, malware or malicious code;</li>
            <li>impersonate any person or misrepresent your affiliation with any person or entity;</li>
            <li>interfere with, disrupt or overburden the Service or any connected network.</li>
          </ul>
          <p className="mt-3">
            Any violation will result in immediate termination of your account and forfeiture of
            all amounts paid, and may be reported to the relevant authorities. You agree that we
            may pursue all available civil and criminal remedies.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. User Content &amp; Feedback</h2>
          <p>
            Any reviews, ratings, comments, suggestions or other material you submit
            (&ldquo;User Content&rdquo;) is non-confidential and non-proprietary. You hereby grant
            Technova a perpetual, irrevocable, worldwide, royalty-free, fully paid-up,
            sublicensable and transferable licence to use, reproduce, modify, adapt, publish,
            translate, distribute and exploit such User Content in any media, without any
            obligation or compensation to you. You are solely responsible for your User Content
            and we disclaim all liability in connection with it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. Third-Party Services</h2>
          <p>
            The Service integrates with and relies on third-party providers, including but not
            limited to payment gateways (e.g. PayU), communication providers (e.g. MSG91),
            identity providers (e.g. Google), cloud hosting, content-delivery networks and
            analytics platforms. Technova is not responsible for the acts, omissions, outages,
            errors, data handling, pricing or policies of any third party. Your use of such
            third-party services is governed by their respective terms, and we make no
            representation or warranty on their behalf.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. Service Availability &amp; Changes</h2>
          <p>
            The Service is provided on a commercially reasonable effort basis only. We do not
            guarantee uninterrupted, timely, secure, error-free or virus-free availability. We
            may, at any time and without notice, add, remove, modify, suspend, restrict or
            discontinue any part of the Service (including individual titles, features, plans,
            prices, devices or regions). We will have no liability to you or any third party for
            any such change, and no such change shall entitle you to any refund or compensation.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">10. Disclaimer of Warranties</h2>
          <p className="uppercase text-sm tracking-wide">
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICE, ALL CONTENT AND ALL
            RELATED MATERIALS ARE PROVIDED &ldquo;AS IS&rdquo;, &ldquo;AS AVAILABLE&rdquo; AND
            &ldquo;WITH ALL FAULTS&rdquo;, WITHOUT WARRANTY OF ANY KIND, WHETHER EXPRESS, IMPLIED,
            STATUTORY OR OTHERWISE. TECHNOVA EXPRESSLY DISCLAIMS ALL WARRANTIES, INCLUDING BUT
            NOT LIMITED TO ANY IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
            PURPOSE, QUIET ENJOYMENT, ACCURACY, TITLE AND NON-INFRINGEMENT. WE DO NOT WARRANT
            THAT THE SERVICE WILL MEET YOUR REQUIREMENTS, BE AVAILABLE ON AN UNINTERRUPTED,
            SECURE OR ERROR-FREE BASIS, OR THAT DEFECTS WILL BE CORRECTED. YOU ASSUME THE ENTIRE
            RISK ARISING OUT OF YOUR USE OF THE SERVICE.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">11. Limitation of Liability</h2>
          <p className="uppercase text-sm tracking-wide">
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL TECHNOVA
            SOLUTIONS, ITS AFFILIATES, DIRECTORS, OFFICERS, EMPLOYEES, AGENTS, LICENSORS,
            CONTENT PARTNERS OR SERVICE PROVIDERS BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
            SPECIAL, CONSEQUENTIAL, EXEMPLARY, PUNITIVE OR ENHANCED DAMAGES, OR FOR ANY LOSS OF
            PROFITS, REVENUE, GOODWILL, DATA, CONTENT, DEVICE DAMAGE, BUSINESS INTERRUPTION,
            PERSONAL INJURY OR EMOTIONAL DISTRESS, ARISING OUT OF OR RELATING TO THESE TERMS OR
            THE SERVICE, WHETHER BASED ON CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT
            LIABILITY OR ANY OTHER THEORY, AND WHETHER OR NOT TECHNOVA HAS BEEN ADVISED OF THE
            POSSIBILITY OF SUCH DAMAGES. OUR TOTAL AGGREGATE LIABILITY FOR ANY AND ALL CLAIMS
            ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE AMOUNT
            ACTUALLY PAID BY YOU TO TECHNOVA DURING THE THREE (3) MONTHS IMMEDIATELY PRECEDING
            THE EVENT GIVING RISE TO THE CLAIM, OR INR 1,000 (ONE THOUSAND RUPEES), WHICHEVER IS
            LOWER. THIS LIMITATION APPLIES EVEN IF ANY REMEDY FAILS OF ITS ESSENTIAL PURPOSE.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">12. Force Majeure</h2>
          <p>
            Technova shall not be liable for any failure or delay in performance caused by events
            beyond its reasonable control, including acts of God, natural disasters, pandemics,
            epidemics, wars, terrorism, civil disturbances, strikes, labour disputes, government
            actions, regulatory changes, power failures, internet, hosting or telecommunication
            outages, cyber-attacks, data-centre failures or third-party service disruptions.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">13. Indemnification</h2>
          <p>
            You agree to defend, indemnify and hold harmless Technova Solutions, its affiliates,
            officers, directors, employees, agents, licensors and partners from and against any
            and all claims, damages, losses, liabilities, costs and expenses (including
            reasonable legal fees) arising out of or in any way connected with: (a) your use or
            misuse of the Service; (b) your breach of these Terms or any applicable law; (c)
            your User Content; or (d) your violation of any third-party rights.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">14. Termination</h2>
          <p>
            We may suspend, restrict or terminate your access to the Service (in whole or in
            part) at any time, for any or no reason, with or without notice, including for any
            suspected violation of these Terms or any applicable law. Upon termination, your
            right to use the Service will cease immediately, and you will not be entitled to any
            refund of amounts paid. Sections that by their nature should survive termination
            (including ownership, disclaimers, limitation of liability, indemnification and
            dispute-resolution provisions) shall survive.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">15. Governing Law &amp; Dispute Resolution</h2>
          <p>
            These Terms are governed by and construed in accordance with the laws of the Republic
            of India, without regard to its conflict-of-laws rules. Any dispute, controversy or
            claim arising out of or relating to these Terms or the Service shall first be
            attempted to be resolved amicably by written notice. Failing resolution within thirty
            (30) days, the dispute shall be finally settled by binding arbitration conducted by a
            sole arbitrator appointed by Technova, under the Arbitration and Conciliation Act,
            1996. The seat and venue of arbitration shall be India, the language shall be
            English, and the award shall be final and binding. Subject to the foregoing, the
            courts at our registered office shall have exclusive jurisdiction. You waive any
            right to participate in a class action, class arbitration or representative
            proceeding.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">16. Changes to these Terms</h2>
          <p>
            We may update these Terms at any time by posting the revised version on the Service.
            Changes are effective immediately upon posting. Your continued use of the Service
            after posting constitutes your acceptance of the revised Terms. It is your
            responsibility to review these Terms periodically.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">17. Miscellaneous</h2>
          <p>
            These Terms, together with the Privacy Policy and Refund Policy, constitute the
            entire agreement between you and Technova regarding the Service and supersede all
            prior understandings. If any provision is held invalid or unenforceable, the
            remaining provisions shall remain in full force. Our failure to enforce any right or
            provision shall not be deemed a waiver. You may not assign these Terms without our
            prior written consent; we may assign freely. Notices to you may be delivered by
            email, in-app message or posting on the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">18. Contact</h2>
          <p>
            For any queries relating to these Terms, please write to us at{" "}
            <a href="mailto:support@bistar.app" className="text-[var(--primary)] hover:underline">
              support@bistar.app
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
