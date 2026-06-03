// Stripe Checkout success landing page.
//
// Stripe's `success_url` redirects paying customers here with a `?session_id=`
// query param appended. We render an on-brand confirmation — no server-side
// session verification needed (the webhook handles fulfilment). Server
// component: no client JS required.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Welcome to Foxie — You're in 🎉",
  description:
    "Thanks for signing up for Foxie AI Receptionist. We'll reach out within 24 hours to set up your phone number, WhatsApp, and menu.",
  robots: { index: false, follow: false },
};

const WHATSAPP_URL = "https://wa.me/601154302561";

export default async function BusinessWelcome({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Stripe appends ?session_id={CHECKOUT_SESSION_ID}. We read it for display
  // only — fulfilment is handled server-side by the Stripe webhook.
  const params = await searchParams;
  const raw = params.session_id;
  const sessionId = Array.isArray(raw) ? raw[0] : raw;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {/* Top nav — mirrors /business */}
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <a href="/business" className="flex items-center gap-2 font-bold text-lg">
          <span className="text-2xl">🦊</span>
          <span>Foxie <span className="text-slate-400 font-normal">/ AI Receptionist</span></span>
        </a>
      </header>

      <main className="max-w-3xl mx-auto px-6 pt-10 pb-24">
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-8 sm:p-12 shadow-2xl text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-3xl mb-6">
            ✓
          </div>

          <span className="inline-block text-xs uppercase tracking-widest text-emerald-300 font-semibold mb-4 border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 rounded-full">
            You&apos;re signed up
          </span>

          <h1 className="text-4xl sm:text-5xl font-bold leading-tight mb-4">
            You&apos;re in <span aria-hidden>🎉</span>
          </h1>
          <p className="text-lg text-slate-300 leading-relaxed max-w-xl mx-auto mb-2">
            Welcome to Foxie. Let&apos;s get your AI Receptionist set up.
          </p>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            We&apos;ll reach out on WhatsApp within 24 hours to start setup — no further action needed right now.
          </p>
        </div>

        {/* What happens next */}
        <section className="mt-8 rounded-2xl bg-slate-900/40 border border-slate-800 p-8">
          <h2 className="text-xl font-semibold mb-6">What happens next</h2>
          <ol className="space-y-5">
            <NextStep n="1" title="We reach out within 24 hours">
              Our team contacts you on WhatsApp to kick off onboarding — no waiting in a queue.
            </NextStep>
            <NextStep n="2" title="We set up your number + WhatsApp">
              We connect Foxie in front of your existing phone line and WhatsApp Business number. You keep both.
            </NextStep>
            <NextStep n="3" title="We load your menu">
              Foxie syncs from a Google Sheet you control — prices, dishes, promos. Update it anytime.
            </NextStep>
          </ol>
        </section>

        {/* Actions */}
        <div className="mt-8 flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-center">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener"
            className="px-6 py-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-lg shadow-lg shadow-emerald-500/20 text-center"
          >
            💬 Talk to us on WhatsApp →
          </a>
          <a
            href="/business"
            className="px-6 py-3.5 rounded-lg border border-slate-600 hover:border-slate-400 text-slate-200 hover:text-white text-lg text-center"
          >
            Back to Foxie
          </a>
        </div>

        {/* Support line */}
        <p className="text-center text-sm text-slate-400 mt-10">
          Questions? Email{" "}
          <a href="mailto:crissfun96@gmail.com" className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2">
            crissfun96@gmail.com
          </a>{" "}
          or message us on WhatsApp — we reply within 24 hours.
        </p>

        {sessionId && (
          <p className="text-center text-xs text-slate-600 mt-4">
            Reference: <code className="text-slate-500">{sessionId}</code>
          </p>
        )}
      </main>

      {/* Footer — mirrors /business */}
      <footer className="border-t border-slate-800 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div>🦊 Foxie — built in KL by an actual restaurant operator.</div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="https://songhwa-cs-agent.vercel.app" className="hover:text-slate-300">Live demo</a>
            <a href="/business#contact" className="hover:text-slate-300">Contact</a>
            <a href="/privacy" className="hover:text-slate-300">Privacy</a>
            <a href="/pdpa" className="hover:text-slate-300">PDPA</a>
            <a href="/terms" className="hover:text-slate-300">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function NextStep({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <div className="w-9 h-9 shrink-0 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-base font-bold">
        {n}
      </div>
      <div>
        <h3 className="font-semibold text-slate-100 mb-1">{title}</h3>
        <p className="text-sm text-slate-400 leading-relaxed">{children}</p>
      </div>
    </li>
  );
}
