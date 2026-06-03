import type { Metadata } from "next";
import { LegalLayout, Section, P, Bullets } from "@/components/legal/LegalLayout";

export const metadata: Metadata = {
  title: "Privacy Policy — Songhwa Korean Cuisine",
  description:
    "How Songhwa Korean Cuisine collects, uses, shares, and protects your personal data when you use our AI reservation assistant by phone, web, or WhatsApp.",
};

const LAST_UPDATED = "3 June 2026";

export default function PrivacyPolicy() {
  return (
    <LegalLayout
      title="Privacy Policy"
      intro="This policy explains what personal data Songhwa Korean Cuisine (松花韩食 · 송화한식) collects when you interact with our AI reservation assistant — by phone, on our website, or over WhatsApp — and how we use, share, and protect it."
      lastUpdated={LAST_UPDATED}
    >
      <Section heading="1. Who we are">
        <P>
          Songhwa Korean Cuisine (&ldquo;Songhwa&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) operates a restaurant at
          Level 8, Millerz Square, Unit 08-05, 357 Jalan Klang Lama (Old Klang Road), 58000 Kuala Lumpur, Malaysia.
          We use an AI assistant (&ldquo;Foxie&rdquo;) to take reservations and answer enquiries. For the personal
          data described here, Songhwa is the data user under Malaysia&rsquo;s Personal Data Protection Act 2010
          (PDPA). Our formal PDPA notice is at{" "}
          <a href="/pdpa" className="text-emerald-300 underline underline-offset-2">/pdpa</a>.
        </P>
        <P>
          For any privacy question or request, call or WhatsApp <strong>+60 11-5430 2561</strong>, or speak to our
          team in person at the restaurant.
        </P>
      </Section>

      <Section heading="2. Information we collect">
        <P>We only collect what we need to take and manage your booking or answer your enquiry:</P>
        <Bullets
          items={[
            <><strong>Reservation details</strong> — your name, phone number, party size, date and time, any menu/set choice, and any special requests or remarks you give (e.g. allergies, occasion, seating preference).</>,
            <><strong>Returning-guest profile</strong> — if you book again with the same phone number, we keep a simple history (visit count, last visit, and the dishes you ordered before) so we can serve you better.</>,
            <><strong>Feedback &amp; callbacks</strong> — if you make a complaint or ask us to call you back, we record your name, phone, and what you told us.</>,
            <><strong>Messages you send us</strong> — the content of your WhatsApp messages to our number, and your WhatsApp display name and number as provided by WhatsApp.</>,
            <><strong>Voice conversations</strong> — when you speak to the assistant, your speech is processed so the assistant can understand and respond (see section 4). We capture the booking details from the conversation, not a recording of it.</>,
            <><strong>Incomplete bookings</strong> — if a booking is started but not finished, we may keep the partial details so our staff can follow up.</>,
          ]}
        />
      </Section>

      <Section heading="3. How we use your information &amp; our lawful basis">
        <Bullets
          items={[
            "To create, confirm, change, or cancel your reservation.",
            "To send you a booking confirmation and a reminder before your visit (by WhatsApp).",
            "To answer your questions about the menu, hours, location, promotions, and allergens.",
            "To handle complaints, callbacks, and requests that need a staff member.",
            "To recognise returning guests and remember preferences you've shared.",
            "To keep the service secure and prevent abuse (e.g. rate-limiting and spam protection).",
          ]}
        />
        <P>
          We process this data because it is necessary to act on your booking request and provide the service you
          ask for, and for our legitimate interest in operating and securing that service. Any sensitive detail you
          choose to share (for example, an allergy) is used only to serve your request. Where we rely on your
          consent, you may withdraw it at any time, though we may then be unable to manage your booking. We do{" "}
          <strong>not</strong> sell your personal data or use it for third-party advertising.
        </P>
      </Section>

      <Section heading="4. Voice &amp; call recording — what actually happens">
        <P>We want to be precise about voice, because it matters:</P>
        <Bullets
          items={[
            <><strong>On our website</strong>, your microphone audio is streamed live to Google&rsquo;s Gemini AI so it can understand you and reply in real time. We do <strong>not</strong> save a recording or a transcript of that web conversation on our systems — only the booking details you confirm are stored.</>,
            <><strong>On the phone</strong>, the call is handled by our telephony provider (Vapi). Our own systems store only your phone number and the booking details — not the audio. The call may itself be recorded or transcribed by the telephony/voice provider on its platform (subject to that provider&rsquo;s privacy terms), and our assistant discloses at the start of the call that it may be recorded for service quality.</>,
            <><strong>On WhatsApp</strong>, we store the text of your messages so the assistant can hold a conversation and our staff can follow up. If you send a voice note, the audio is <strong>not</strong> downloaded, transcribed, or processed — but a small record (your phone number, the time, and a media reference ID) is stored; the audio itself stays on Meta&rsquo;s servers.</>,
          ]}
        />
      </Section>

      <Section heading="5. Who we share it with">
        <P>
          We use trusted technology providers to run the assistant. They process your data only to provide their
          service to us. These may include:
        </P>
        <Bullets
          items={[
            <><strong>Google</strong> — the Gemini AI that understands and answers you, and Firebase/Firestore where your booking records are securely stored.</>,
            <><strong>Vapi</strong> — the phone/voice platform that powers the telephone assistant.</>,
            <><strong>Meta (WhatsApp Business Cloud API)</strong> — used to receive your WhatsApp messages and to send you booking confirmations and reminders containing your name and booking details.</>,
            <><strong>Our internal staff-notification service</strong> — to alert our team, booking and complaint details are sent to our staff Telegram and to a staff WhatsApp group. The staff-group alerts are delivered by a notification service running on our own hardware using a dedicated WhatsApp account; this path does not go through Meta&rsquo;s official business platform.</>,
            <><strong>Vercel</strong> — our website and application hosting provider.</>,
          ]}
        />
        <P>
          Our billing provider (Stripe) is used only for restaurant-business subscriptions to the Foxie product and
          receives the business owner&rsquo;s contact and payment details as part of checkout — it does{" "}
          <strong>not</strong> receive diners&rsquo; personal data.
        </P>
        <P>
          We may also disclose data where required by law, or to protect the rights, safety, and property of Songhwa,
          our guests, or others.
        </P>
      </Section>

      <Section heading="6. Where your data is processed">
        <P>
          Some of the providers above process data on servers outside Malaysia. Where that happens, the transfer is
          necessary to provide the service you have requested, and each provider is bound by its own data-protection
          terms. We take reasonable steps to ensure your data continues to be protected to a standard consistent with
          the PDPA.
        </P>
      </Section>

      <Section heading="7. How long we keep it">
        <P>
          We keep your personal data only for as long as necessary for the purposes above. As a guide, we retain
          returning-guest booking data for up to 24 months after your most recent visit, after which we delete or
          anonymise it. Records we are legally required to keep (for example, for tax) are kept for the period the law
          requires. You can ask us to delete your data sooner — see section 9.
        </P>
      </Section>

      <Section heading="8. How we protect it">
        <Bullets
          items={[
            "Your records are stored in a database that is not publicly accessible — only our server, with credentials, can read or write it.",
            "We removed any public way to list other guests' bookings; on the website you only ever see the bookings you made in your current session.",
            "We apply rate-limiting and abuse protection to our booking and lookup endpoints, and verify the authenticity of incoming messages from WhatsApp and our payment provider.",
            "When we look up a returning guest, the phone number is shown masked.",
            "Staff access to the admin tools is password-protected.",
          ]}
        />
        <P>No system can be guaranteed 100% secure, but we take reasonable steps to protect your personal data.</P>
      </Section>

      <Section heading="9. Your rights">
        <P>Under the PDPA you may, by contacting us at the number above:</P>
        <Bullets
          items={[
            "Ask what personal data we hold about you and request a copy (access).",
            "Ask us to correct data that is wrong or out of date (correction).",
            "Ask us to delete your data.",
            "Ask us to stop sending you WhatsApp reminders, or to not keep a returning-guest profile for you, while still letting us manage a current booking.",
            "Withdraw consent to us contacting you (note: we may then be unable to manage your booking).",
          ]}
        />
        <P>
          We will respond to access and correction requests within 21 days, as required by the PDPA. Today, access and
          deletion requests are actioned manually by our team.
        </P>
      </Section>

      <Section heading="10. Children">
        <P>
          The assistant is intended for adults making restaurant bookings. If someone appears to be under 18, the
          assistant asks for a parent or guardian to confirm the booking with us directly.
        </P>
      </Section>

      <Section heading="11. Cookies &amp; local storage">
        <P>
          Our website does not use advertising or cross-site tracking cookies. It uses your browser&rsquo;s local
          storage only to remember whether to show the new-visitor hint card (a simple visit counter). Bookings you
          confirm during a visit are shown on screen but are held in memory only — they are not written to local
          storage and are cleared when you leave or refresh the page.
        </P>
      </Section>

      <Section heading="12. Changes to this policy">
        <P>
          We may update this policy from time to time. The &ldquo;last updated&rdquo; date at the top reflects the
          latest version. For returning guests with whom we have an active WhatsApp relationship, we will notify you of
          material changes by WhatsApp.
        </P>
      </Section>

      <Section heading="13. Contact">
        <P>
          Questions or requests about your personal data: call or WhatsApp <strong>+60 11-5430 2561</strong>, or speak
          to our team at Level 8, Millerz Square, Old Klang Road, Kuala Lumpur. See also our{" "}
          <a href="/pdpa" className="text-emerald-300 underline underline-offset-2">PDPA Notice</a> and{" "}
          <a href="/terms" className="text-emerald-300 underline underline-offset-2">Terms of Service</a>.
        </P>
      </Section>
    </LegalLayout>
  );
}
