"use client";

import { useState } from "react";

type Tier = "starter" | "growth" | "pro" | "enterprise" | "unsure";

export default function BusinessLanding() {
  const [form, setForm] = useState({
    restaurantName: "",
    contactName: "",
    contactRole: "",
    email: "",
    phone: "",
    outlets: 1,
    tier: "growth" as Tier,
    cuisine: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (j.success) {
        setResult({ ok: true, msg: j.data.message ?? "Thanks — we'll be in touch within 24 hours." });
        setForm({ ...form, notes: "" });
      } else {
        setResult({ ok: false, msg: j.error ?? "Something went wrong. Please try again." });
      }
    } catch {
      setResult({ ok: false, msg: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {/* Top nav */}
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <a href="/business" className="flex items-center gap-2 font-bold text-lg">
          <span className="text-2xl">🦊</span>
          <span>Foxie <span className="text-slate-400 font-normal">/ AI Receptionist</span></span>
        </a>
        <nav className="hidden sm:flex gap-6 text-sm text-slate-300">
          <a href="#how" className="hover:text-white">How it works</a>
          <a href="#pricing" className="hover:text-white">Pricing</a>
          <a href="#demo" className="hover:text-white">Live demo</a>
          <a href="#contact" className="px-3 py-1.5 rounded-md bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400">
            Get started
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-12 pb-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-block text-xs uppercase tracking-widest text-emerald-300 font-semibold mb-4 border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 rounded-full">
              Built by an actual F&B operator
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              Your AI Receptionist.<br />
              <span className="text-emerald-400">24/7. Four languages.</span><br />
              <span className="text-slate-300 text-3xl sm:text-4xl lg:text-5xl">Answers every call and WhatsApp.</span>
            </h1>
            <p className="text-lg text-slate-300 mb-8 leading-relaxed max-w-xl">
              Stop missing reservations after-hours. Foxie picks up your phone and replies on WhatsApp in English, 中文, Bahasa Malaysia, and 한국어 — books tables, answers menu questions, transfers to a real human when needed.
            </p>
            <div className="flex flex-wrap gap-4 items-center">
              <a
                href="#contact"
                className="px-6 py-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-lg shadow-lg shadow-emerald-500/20"
              >
                Start 30-day trial →
              </a>
              <a
                href="https://songhwa-cs-agent.vercel.app"
                target="_blank"
                rel="noopener"
                className="px-6 py-3.5 rounded-lg border border-slate-600 hover:border-slate-400 text-slate-200 hover:text-white text-lg"
              >
                Try the live demo
              </a>
            </div>
            <p className="text-xs text-slate-500 mt-5">
              No credit card. Cancel anytime. Built and dogfooded at Songhwa Korean Cuisine, Kuala Lumpur.
            </p>
          </div>

          <div className="relative">
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-2xl">
              <div className="flex items-center gap-2 mb-4 text-xs text-slate-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Live call · Songhwa Korean Cuisine
              </div>
              <div className="space-y-3 text-sm">
                <ChatLine who="🤖 Foxie" tone="slate" text="Thank you for calling Songhwa Korean Cuisine! This call may be recorded for service quality. How can I help you today?" />
                <ChatLine who="📞 Customer" tone="blue" text="Hi! I want to book a table for 4 this Saturday at 7pm." />
                <ChatLine who="🤖 Foxie" tone="slate" text="One moment, let me check that for you... ✓ 7pm Saturday is available. Can I have your name and phone please?" />
                <ChatLine who="📞 Customer" tone="blue" text="Chris, 012-345 6789" />
                <ChatLine who="🤖 Foxie" tone="slate" text="Great, Chris. Booking confirmed: 4 pax, Saturday 7pm. Staff has been notified via Telegram and WhatsApp. See you then!" />
              </div>
              <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-3 gap-2 text-center text-xs">
                <Stat label="Avg call" value="2 min 14s" />
                <Stat label="Languages" value="EN · 中 · BM · 한" />
                <Stat label="Bookings/day" value="+18%" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social proof */}
      <section className="border-y border-slate-800 bg-slate-900/40 py-8">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-center text-xs uppercase tracking-widest text-slate-500 mb-4">
            Built for SEA F&B. Tested daily at:
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 sm:gap-12 text-slate-300">
            <span className="font-semibold text-lg">松花韩식 Songhwa Korean Cuisine</span>
            <span className="text-slate-700">·</span>
            <span className="font-semibold text-lg">Byond Walls Pizza</span>
            <span className="text-slate-700">·</span>
            <span className="font-semibold text-lg">HWC Coffee <span className="text-slate-500 text-sm">(pilot)</span></span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3">From dial-tone to confirmed booking in 90 seconds.</h2>
        <p className="text-center text-slate-400 mb-14 max-w-2xl mx-auto">
          You keep your existing phone number and WhatsApp. We slot Foxie in front. Your staff sees every reservation in Telegram, WhatsApp, and a clean admin dashboard.
        </p>
        <div className="grid md:grid-cols-3 gap-8">
          <Step n="1" title="Customer calls or texts">
            They dial your restaurant number or message your WhatsApp Business line — exactly like they do today.
          </Step>
          <Step n="2" title="Foxie answers in seconds">
            AI receptionist greets in the customer's language, checks availability, books tables, answers menu questions. Refuses to invent prices or freebies.
          </Step>
          <Step n="3" title="You get the booking">
            Telegram + WhatsApp ping your staff group within 2 seconds. Tap once to see admin. Customer hears "see you Saturday" — done.
          </Step>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Feature emoji="📞" title="Real phone calls">
            Twilio Malaysian number. Customer dials, AI answers. No app for them to download.
          </Feature>
          <Feature emoji="💬" title="WhatsApp auto-reply">
            Customers message your WA Business number, AI replies in seconds — full multi-turn conversation, books tables, sends confirmations.
          </Feature>
          <Feature emoji="🌐" title="4 languages out of the box">
            English · 中文 · Bahasa Malaysia · 한국어. Mirrors the customer's language — even mid-sentence Manglish.
          </Feature>
          <Feature emoji="🤝" title="Live human handoff">
            Customer says "speak to a manager" — AI immediately bridges the call to your phone OR alerts you on Telegram. No customer waits in limbo.
          </Feature>
          <Feature emoji="🔒" title="PDPA compliant">
            Automatic recording disclosure in every greeting. Refuses to capture credit cards or NRIC. Rate-limited against abuse.
          </Feature>
          <Feature emoji="📊" title="Staff dashboard">
            Live view of reservations, complaints, callbacks, handoffs. One-tap resolve. Auto-refreshes every 15s.
          </Feature>
          <Feature emoji="🍱 " title="Knows your menu">
            Live-synced from a Google Sheet you control. Update prices, add a dish, AI knows within 5 minutes.
          </Feature>
          <Feature emoji="🏷️" title="No invented promos">
            Strict guardrail — AI refuses to offer discounts or freebies that aren't in your live promo sheet. No more "free cake on my birthday" surprises.
          </Feature>
          <Feature emoji="⚡" title="Always on">
            Answers Sunday 3am. Answers public holidays. Answers when you're closed (and tells them when you reopen).
          </Feature>
        </div>
      </section>

      {/* Live demo CTA */}
      <section id="demo" className="max-w-6xl mx-auto px-6 py-20">
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-10 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Try the live demo right now.</h2>
          <p className="text-slate-300 mb-6 max-w-xl mx-auto">
            Tap the link below to talk to Songhwa Korean Cuisine's real AI receptionist. Book a fake reservation, ask about the menu in Bahasa, see what your customers will hear.
          </p>
          <a
            href="https://songhwa-cs-agent.vercel.app"
            target="_blank"
            rel="noopener"
            className="inline-block px-8 py-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-lg"
          >
            🎙️ Talk to Foxie at Songhwa →
          </a>
          <p className="text-xs text-slate-500 mt-4">
            Test bookings get cleaned up. No real reservation is held.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3">Pricing that pays for itself.</h2>
        <p className="text-center text-slate-400 mb-14 max-w-2xl mx-auto">
          One outlet at our Growth tier saves ~RM 2,000/month vs hiring a part-time WhatsApp + phone admin.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <PricingCard
            tier="Starter"
            price="RM 299"
            sub="per outlet / month"
            features={[
              "1 channel (WhatsApp or voice)",
              "200 voice minutes / month",
              "EN + Bahasa Malaysia",
              "Google Calendar booking",
              "Telegram staff alerts",
              "Email support, 48h",
            ]}
            cta="Best for solo cafés"
          />
          <PricingCard
            tier="Growth"
            price="RM 899"
            sub="per outlet / month"
            highlight
            features={[
              "Phone + WhatsApp + web",
              "1,500 voice minutes",
              "Unlimited WhatsApp service msgs",
              "EN · 中文 · Bahasa · 한국어",
              "StoreHub POS integration",
              "Telegram + WA group alerts",
              "WhatsApp support, 12h",
            ]}
            cta="Recommended for 1–3 outlets"
          />
          <PricingCard
            tier="Pro"
            price="RM 2,499"
            sub="per outlet / month"
            features={[
              "Everything in Growth",
              "6,000 voice minutes",
              "Custom voice clone (ElevenLabs)",
              "POS + CRM webhooks",
              "White-label dashboard",
              "Unlimited outlets, volume discount 10+",
              "Dedicated WA support + SLA",
            ]}
            cta="For chains: HWC, Tealive, OldTown"
          />
          <PricingCard
            tier="Privacy"
            price="Custom"
            sub="enterprise / capex"
            features={[
              "100% local: Mesolitica + Qwen",
              "Runs on your Mac Studio / on-prem",
              "No customer data leaves premises",
              "PDPA-grade data residency",
              "RM 6–10K hardware + RM 999/mo",
              "Best for hospital, school, gov F&B",
            ]}
            cta="For data-sensitive operations"
          />
        </div>
        <p className="text-center text-xs text-slate-500 mt-8">
          All tiers include free Mesolitica Bahasa Malaysia upgrade for Malay-heavy outlets · Pricing in MYR · Annual contracts get 15% off
        </p>
      </section>

      {/* Founder note */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-8">
          <p className="text-xs uppercase tracking-widest text-emerald-300 font-semibold mb-3">From the founder</p>
          <p className="text-lg text-slate-200 leading-relaxed mb-4">
            &ldquo;I built Foxie because Songhwa was losing reservations after-hours and getting our existing staff burned out replying to WhatsApp at 11pm. The big-tech AI tools weren&apos;t built for Malaysian F&B — they don&apos;t speak Bahasa properly, they don&apos;t understand halal context, they don&apos;t integrate with StoreHub. So I made our own. We&apos;ve been running it at Songhwa for 30 days. Now I&apos;m opening it up to other operators.&rdquo;
          </p>
          <p className="text-sm text-slate-400">
            — Chris Fun, CEO Songhwa Korean Cuisine · Co-founder Byond Walls · Tech consultant HWC Coffee (75 outlets)
          </p>
        </div>
      </section>

      {/* Contact form */}
      <section id="contact" className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3">Talk to us.</h2>
        <p className="text-center text-slate-400 mb-10">
          Quick form. We reply within 24 hours. First 30 days free for the first 5 KL design-partner outlets.
        </p>
        <form onSubmit={submit} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Restaurant / Brand name *">
              <input
                required type="text" value={form.restaurantName}
                onChange={(e) => setForm({ ...form, restaurantName: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
                placeholder="e.g. Tealive"
              />
            </Field>
            <Field label="How many outlets? *">
              <input
                required type="number" min={1} max={500} value={form.outlets}
                onChange={(e) => setForm({ ...form, outlets: Number(e.target.value) || 1 })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </Field>
            <Field label="Your name *">
              <input
                required type="text" value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </Field>
            <Field label="Your role">
              <input
                type="text" value={form.contactRole}
                onChange={(e) => setForm({ ...form, contactRole: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
                placeholder="Owner, Ops Manager, etc."
              />
            </Field>
            <Field label="Email *">
              <input
                required type="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </Field>
            <Field label="WhatsApp / phone *">
              <input
                required type="tel" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
                placeholder="+60 12-345 6789"
              />
            </Field>
            <Field label="Cuisine">
              <input
                type="text" value={form.cuisine}
                onChange={(e) => setForm({ ...form, cuisine: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
                placeholder="Korean, Western, mamak, café..."
              />
            </Field>
            <Field label="Which tier fits? *">
              <select
                required value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value as Tier })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="starter">Starter (RM 299)</option>
                <option value="growth">Growth (RM 899)</option>
                <option value="pro">Pro (RM 2,499)</option>
                <option value="enterprise">Privacy Enterprise</option>
                <option value="unsure">Not sure — help me choose</option>
              </select>
            </Field>
          </div>
          <Field label="Anything specific?">
            <textarea
              value={form.notes} rows={3}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
              placeholder="e.g. We use StoreHub POS, we get 200 WA messages a day, we'd love voice cloning..."
            />
          </Field>

          {result && (
            <div className={`text-sm px-4 py-3 rounded-lg ${result.ok ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-200" : "bg-red-500/15 border border-red-500/40 text-red-200"}`}>
              {result.msg}
            </div>
          )}

          <button
            type="submit" disabled={submitting}
            className="w-full px-6 py-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 text-slate-950 font-semibold text-lg"
          >
            {submitting ? "Sending…" : "Get my free 30-day trial →"}
          </button>
          <p className="text-xs text-center text-slate-500">
            We&apos;ll reply via WhatsApp within 24h. No spam, no autoplay videos, no bullshit.
          </p>
        </form>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-10 mt-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div>🦊 Foxie — built in KL by an actual restaurant operator.</div>
          <div className="flex gap-6">
            <a href="https://songhwa-cs-agent.vercel.app" className="hover:text-slate-300">Live demo</a>
            <a href="#contact" className="hover:text-slate-300">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Small subcomponents ───────────────────────────────────────

function ChatLine({ who, text, tone }: { who: string; text: string; tone: "slate" | "blue" }) {
  const bg = tone === "slate" ? "bg-slate-800/60" : "bg-blue-500/10 border border-blue-500/30";
  return (
    <div className={`rounded-lg px-3 py-2 ${bg}`}>
      <div className="text-xs text-slate-400 mb-1">{who}</div>
      <div className="text-slate-200">{text}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6">
      <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-lg font-bold mb-4">
        {n}
      </div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-slate-400 leading-relaxed">{children}</p>
    </div>
  );
}

function Feature({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 hover:border-slate-700 transition-colors">
      <div className="text-2xl mb-3">{emoji}</div>
      <h3 className="font-semibold mb-2 text-slate-100">{title}</h3>
      <p className="text-sm text-slate-400 leading-relaxed">{children}</p>
    </div>
  );
}

function PricingCard({
  tier, price, sub, features, cta, highlight,
}: {
  tier: string; price: string; sub: string; features: string[]; cta: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-2xl p-6 ${highlight ? "bg-emerald-500/10 border-2 border-emerald-500/50 shadow-lg shadow-emerald-500/10" : "bg-slate-900/60 border border-slate-800"}`}>
      {highlight && (
        <div className="text-xs uppercase tracking-widest text-emerald-300 font-semibold mb-3">Most popular</div>
      )}
      <h3 className="text-xl font-bold mb-1">{tier}</h3>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-3xl font-bold">{price}</span>
      </div>
      <div className="text-xs text-slate-400 mb-5">{sub}</div>
      <ul className="space-y-2 mb-5 text-sm text-slate-300">
        {features.map((f) => (
          <li key={f} className="flex gap-2"><span className="text-emerald-400 shrink-0">✓</span> <span>{f}</span></li>
        ))}
      </ul>
      <p className="text-xs text-slate-500 italic">{cta}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1.5">{label}</label>
      {children}
    </div>
  );
}
