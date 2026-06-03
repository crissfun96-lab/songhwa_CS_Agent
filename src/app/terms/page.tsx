import type { Metadata } from "next";
import { LegalLayout, Section, P, Bullets } from "@/components/legal/LegalLayout";

export const metadata: Metadata = {
  title: "Terms of Service — Songhwa & Foxie AI Receptionist",
  description:
    "Terms of Service for diners using the Songhwa Korean Cuisine AI reservation assistant, and for restaurants subscribing to the Foxie AI Receptionist product.",
};

const LAST_UPDATED = "3 June 2026";

export default function TermsOfService() {
  return (
    <LegalLayout
      title="Terms of Service"
      intro="These terms cover two audiences: Part A is for diners using the Songhwa Korean Cuisine AI assistant; Part B is for restaurants that subscribe to the Foxie AI Receptionist product. The General section applies to everyone. By using the service, you agree to the terms that apply to you."
      lastUpdated={LAST_UPDATED}
    >
      {/* ───────────────────────── PART A — DINERS ───────────────────────── */}
      <Section heading="Part A — Using the Songhwa booking assistant">
        <P>
          Songhwa Korean Cuisine offers an AI assistant (&ldquo;Foxie&rdquo;) to help you make reservations and answer
          questions by phone, web, and WhatsApp. By using it, you agree to the following (and to the General section
          below, including governing law).
        </P>
        <Bullets
          items={[
            <><strong>It&rsquo;s an automated assistant.</strong> Foxie is an AI, not a person. It does its best to be accurate, but may occasionally be wrong — please confirm important details (date, time, party size, allergens) with our staff.</>,
            <><strong>Bookings are subject to availability and confirmation.</strong> A reservation is only secured once the assistant confirms it. We may need to contact you to adjust or confirm a booking.</>,
            <><strong>Give accurate information.</strong> Please provide a correct name and reachable phone number so we can confirm and manage your booking.</>,
            <><strong>Large groups &amp; events</strong> (around 12+ guests, private functions, celebrations) are handled by our human team, not the assistant — the assistant will pass you to staff.</>,
            <><strong>Not for emergencies.</strong> The assistant is for restaurant bookings and enquiries only.</>,
            <><strong>Menu &amp; dietary information.</strong> Songhwa serves Korean cuisine and is non-halal (it serves pork). Allergen and ingredient information is provided to the best of our knowledge; if you have a serious allergy, please confirm directly with staff.</>,
            <><strong>Acceptable use.</strong> Don&rsquo;t misuse the assistant — no spamming, abusive content, attempts to break or overload the service, or making fake or malicious bookings.</>,
          ]}
        />
        <P>
          Your personal data is handled per our{" "}
          <a href="/privacy" className="text-emerald-300 underline underline-offset-2">Privacy Policy</a> and{" "}
          <a href="/pdpa" className="text-emerald-300 underline underline-offset-2">PDPA Notice</a>.
        </P>
      </Section>

      {/* ───────────────────────── PART B — FOXIE SUBSCRIBERS ───────────────────────── */}
      <Section heading="Part B — Foxie AI Receptionist subscription (for restaurants)">
        <P>
          Foxie is an AI receptionist product for restaurants and cafés, provided by Songhwa Korean Cuisine. These
          terms apply to a business (&ldquo;Subscriber&rdquo;, &ldquo;you&rdquo;) that signs up for Foxie.
        </P>
        <Bullets
          items={[
            <><strong>The service.</strong> Foxie answers calls, web chat, and WhatsApp for your venue — handling reservations, menu questions, and routing to your staff. Features may change as the product evolves.</>,
            <><strong>Subscription &amp; billing.</strong> Foxie is offered on subscription tiers; the price and billing cycle are shown at sign-up and billed via our payment processor (Stripe). Any free trial converts to a paid plan unless cancelled before it ends.</>,
            <><strong>Refunds &amp; cancellation.</strong> You may cancel at any time and keep access until the end of the current paid period. Subscription fees already paid are non-refundable except where a refund is required by law.</>,
            <><strong>Your responsibilities.</strong> You are responsible for the accuracy of the menu, pricing, hours, and other content you provide, and for how you use the assistant with your customers — including giving your customers the required privacy notices and call-recording disclosures.</>,
            <><strong>Data protection roles.</strong> For your customers&rsquo; personal data processed through Foxie, you are the data controller/data user and we act as your data processor, processing it on your instructions to provide the service. A Data Processing Agreement governing these roles is available on request and will be countersigned before processing begins. Each party will comply with applicable data-protection law (including the PDPA).</>,
            <><strong>Acceptable use.</strong> Don&rsquo;t use Foxie for unlawful, deceptive, or abusive purposes, or in a way that infringes others&rsquo; rights or overloads the service.</>,
            <><strong>Availability.</strong> We aim for high availability but do not guarantee uninterrupted service. The service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis.</>,
            <><strong>Suspension &amp; termination.</strong> We may suspend or end the service for non-payment or breach of these terms.</>,
            <><strong>Limitation of liability.</strong> To the extent permitted by law, Songhwa Korean Cuisine is not liable for indirect or consequential losses, and its total liability is limited to the fees you paid in the period giving rise to the claim.</>,
          ]}
        />
      </Section>

      <Section heading="General (applies to everyone)">
        <Bullets
          items={[
            <><strong>Changes.</strong> We may update these terms; the &ldquo;last updated&rdquo; date reflects the current version. Continued use after a change means you accept it.</>,
            <><strong>Governing law.</strong> These terms — for both diners and subscribers — are governed by the laws of Malaysia, and the courts of Kuala Lumpur have jurisdiction.</>,
            <><strong>Contact.</strong> Questions about these terms: call or WhatsApp +60 11-5430 2561, or speak to our team at Level 8, Millerz Square, Old Klang Road, Kuala Lumpur.</>,
          ]}
        />
      </Section>
    </LegalLayout>
  );
}
