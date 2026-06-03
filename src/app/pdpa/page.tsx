import type { Metadata } from "next";
import { LegalLayout, Section, P } from "@/components/legal/LegalLayout";

export const metadata: Metadata = {
  title: "PDPA Notice — Songhwa Korean Cuisine",
  description:
    "Personal Data Protection Notice under Malaysia's Personal Data Protection Act 2010 (PDPA) — Songhwa Korean Cuisine. Notis Perlindungan Data Peribadi.",
};

const LAST_UPDATED = "3 June 2026";

export default function PdpaNotice() {
  return (
    <LegalLayout
      title="Personal Data Protection Notice"
      intro="Issued under the Personal Data Protection Act 2010 (PDPA) of Malaysia by Songhwa Korean Cuisine. An English version and a Bahasa Malaysia version follow, as required by section 7(3) of the PDPA."
      lastUpdated={LAST_UPDATED}
    >
      {/* ───────────────────────── ENGLISH ───────────────────────── */}
      <Section heading="Personal Data Protection Notice (English)">
        <P>
          Songhwa Korean Cuisine (&ldquo;we&rdquo;) collects and processes your personal data when you make a
          reservation or enquiry through our AI assistant by telephone, on our website, or via WhatsApp. This notice
          tells you how, in line with the Personal Data Protection Act 2010.
        </P>
        <P><strong>Personal data we process:</strong> your name, contact (phone) number, party size, reservation date
          and time, menu or set preferences, and any remarks you provide (such as allergies or the occasion); the
          content of WhatsApp messages you send us; complaint or callback details; and, for voice interactions, your
          phone number and the booking details taken from the conversation.</P>
        <P><strong>Purposes:</strong> to create and manage your reservation; to send booking confirmations and
          reminders; to answer your enquiries; to handle feedback, complaints and callbacks; to recognise returning
          guests; and to keep the service secure.</P>
        <P><strong>Lawful basis:</strong> we process your data because it is necessary to act on your booking request
          and to provide the service you ask for, and for our legitimate interest in operating and securing it. Where
          we rely on your consent, you may withdraw it at any time.</P>
        <P><strong>Source:</strong> we obtain your personal data directly from you when you call, message, or use the
          assistant.</P>
        <P><strong>Disclosure:</strong> we may disclose your personal data to: Google (the AI that understands and
          answers you, and the database where bookings are stored); Vapi (our telephony provider — note Vapi may also
          record or transcribe calls on its own platform as part of delivering the service); Meta (WhatsApp Business
          Cloud API, to exchange WhatsApp messages and send confirmations/reminders); our internal staff-notification
          channels (Telegram, and a staff WhatsApp group served by a notification service on our own hardware); our
          hosting provider (Vercel); and any party where required by law.</P>
        <P><strong>Obligatory data:</strong> your name and phone number are required to make a booking. If you do not
          provide them, we cannot process your reservation.</P>
        <P><strong>Your choices to limit processing:</strong> you may ask us to (1) stop sending you WhatsApp
          reminders, (2) not keep a returning-guest profile for you, or (3) delete your data — while still letting us
          handle a current booking where possible — by calling or WhatsApp to <strong>+60 11-5430 2561</strong>.</P>
        <P><strong>Your rights:</strong> you may request access to, or correction of, your personal data by contacting
          us at the number above; we respond within 21 days as required by the PDPA.</P>
        <P><strong>Security &amp; retention:</strong> we take reasonable steps to protect your data and keep it only as
          long as necessary — as a guide, up to 24 months after your most recent visit, after which we delete or
          anonymise it (except records the law requires us to keep).</P>
        <P>
          Full details are in our{" "}
          <a href="/privacy" className="text-emerald-300 underline underline-offset-2">Privacy Policy</a>.
        </P>
      </Section>

      {/* ───────────────────────── BAHASA MALAYSIA ───────────────────────── */}
      <Section heading="Notis Perlindungan Data Peribadi (Bahasa Malaysia)">
        <P>
          Songhwa Korean Cuisine (&ldquo;kami&rdquo;) mengumpul dan memproses data peribadi anda apabila anda membuat
          tempahan atau pertanyaan melalui pembantu AI kami menerusi telefon, laman web kami, atau WhatsApp. Notis ini
          menerangkan caranya, selaras dengan Akta Perlindungan Data Peribadi 2010.
        </P>
        <P><strong>Data peribadi yang diproses:</strong> nama anda, nombor telefon, bilangan tetamu, tarikh dan masa
          tempahan, pilihan menu atau set, serta sebarang catatan yang anda berikan (seperti alahan atau majlis);
          kandungan mesej WhatsApp yang anda hantar kepada kami; butiran aduan atau permintaan panggilan balik; dan,
          bagi interaksi suara, nombor telefon anda serta butiran tempahan yang diambil daripada perbualan.</P>
        <P><strong>Tujuan:</strong> untuk membuat dan menguruskan tempahan anda; menghantar pengesahan dan peringatan
          tempahan; menjawab pertanyaan anda; mengendalikan maklum balas, aduan dan panggilan balik; mengenali tetamu
          yang kembali; dan memastikan keselamatan perkhidmatan.</P>
        <P><strong>Asas yang sah:</strong> kami memproses data anda kerana ia perlu untuk bertindak atas permintaan
          tempahan anda dan menyediakan perkhidmatan yang anda minta, serta bagi kepentingan sah kami untuk
          mengendalikan dan melindunginya. Apabila kami bergantung pada kebenaran anda, anda boleh menariknya balik
          pada bila-bila masa.</P>
        <P><strong>Sumber:</strong> kami memperoleh data peribadi anda secara langsung daripada anda apabila anda
          menghubungi, menghantar mesej, atau menggunakan pembantu ini.</P>
        <P><strong>Pendedahan:</strong> kami mungkin mendedahkan data peribadi anda kepada: Google (AI yang memahami
          dan menjawab anda, serta pangkalan data tempat tempahan disimpan); Vapi (penyedia telefoni kami — Vapi juga
          mungkin merakam atau menyalin perbualan panggilan di platformnya sendiri sebagai sebahagian daripada
          perkhidmatan); Meta (WhatsApp Business Cloud API, untuk bertukar mesej WhatsApp dan menghantar
          pengesahan/peringatan); saluran pemberitahuan kakitangan dalaman kami (Telegram, dan kumpulan WhatsApp
          kakitangan yang dikendalikan oleh perkhidmatan pemberitahuan di perkakasan kami sendiri); penyedia
          pengehosan kami (Vercel); dan mana-mana pihak apabila dikehendaki oleh undang-undang.</P>
        <P><strong>Data wajib:</strong> nama dan nombor telefon anda diperlukan untuk membuat tempahan. Jika anda tidak
          memberikannya, kami tidak dapat memproses tempahan anda.</P>
        <P><strong>Pilihan untuk mengehadkan pemprosesan:</strong> anda boleh meminta kami untuk (1) berhenti menghantar
          peringatan WhatsApp, (2) tidak menyimpan profil tetamu kembali untuk anda, atau (3) memadam data anda —
          sambil membenarkan kami menguruskan tempahan semasa jika boleh — dengan menghubungi atau WhatsApp ke{" "}
          <strong>+60 11-5430 2561</strong>.</P>
        <P><strong>Hak anda:</strong> anda boleh meminta akses kepada, atau pembetulan, data peribadi anda dengan
          menghubungi kami di nombor di atas; kami akan membalas dalam tempoh 21 hari seperti yang dikehendaki oleh
          PDPA.</P>
        <P><strong>Keselamatan &amp; pengekalan:</strong> kami mengambil langkah munasabah untuk melindungi data anda dan
          menyimpannya hanya selama yang perlu — sebagai panduan, sehingga 24 bulan selepas lawatan terakhir anda,
          selepas itu kami memadam atau menyahnamakannya (kecuali rekod yang dikehendaki oleh undang-undang).</P>
        <P>
          Butiran penuh terdapat dalam{" "}
          <a href="/privacy" className="text-emerald-300 underline underline-offset-2">Dasar Privasi</a> kami.
        </P>
      </Section>

      <Section heading="Prevailing language / Bahasa yang diguna pakai">
        <P>
          In the event of any inconsistency between the English and Bahasa Malaysia versions of this notice, the
          Bahasa Malaysia version shall prevail. Sekiranya terdapat sebarang percanggahan antara versi Bahasa Inggeris
          dan Bahasa Malaysia notis ini, versi Bahasa Malaysia hendaklah diguna pakai.
        </P>
      </Section>
    </LegalLayout>
  );
}
