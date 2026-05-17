"use client";

import { useState } from "react";

type Tier = "starter" | "growth" | "pro" | "enterprise";

export default function SignupPage() {
  const [form, setForm] = useState({
    slug: "",
    businessName: "",
    address: "",
    phone: "",
    cuisine: "",
    ownerName: "",
    ownerEmail: "",
    tier: "growth" as Tier,
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; data?: { tenantId: string; trialEndsAt?: string; nextSteps: string[] } } | null>(null);

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (j.success) {
        setResult({ ok: true, msg: "Welcome to Foxie.", data: j.data });
      } else {
        setResult({ ok: false, msg: j.error ?? "Signup failed." });
      }
    } catch {
      setResult({ ok: false, msg: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  if (result?.ok && result.data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-slate-100 flex items-center justify-center px-6">
        <div className="max-w-xl bg-slate-900/80 border border-emerald-500/40 rounded-2xl p-10 text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-3xl font-bold mb-3">Welcome to Foxie.</h1>
          <p className="text-slate-300 mb-6">Your trial tenant is live. 30 days, no card.</p>
          <div className="text-left bg-slate-800/60 border border-slate-700 rounded-lg p-5 mb-6">
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-2">Your tenant ID</div>
            <code className="text-emerald-300 text-lg font-bold">{result.data.tenantId}</code>
            {result.data.trialEndsAt && (
              <div className="text-xs text-slate-400 mt-3">
                Trial ends: {new Date(result.data.trialEndsAt).toLocaleDateString()}
              </div>
            )}
          </div>
          <ul className="text-left space-y-2 text-slate-300 mb-8">
            {result.data.nextSteps.map((step, i) => (
              <li key={i} className="flex gap-3"><span className="text-emerald-400 shrink-0">{i + 1}.</span>{step}</li>
            ))}
          </ul>
          <a href="/business" className="text-sm text-slate-400 hover:text-white underline-offset-2 hover:underline">
            ← Back to homepage
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <header className="max-w-3xl mx-auto px-6 py-5">
        <a href="/business" className="flex items-center gap-2 font-bold text-lg w-fit">
          <span className="text-2xl">🦊</span>
          <span>Foxie <span className="text-slate-400 font-normal">/ Signup</span></span>
        </a>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">Claim your tenant.</h1>
        <p className="text-slate-400 mb-10">
          30-day free trial. No card required. We&apos;ll reach out within 48 hours to provision your phone number and WhatsApp.
        </p>

        <form onSubmit={submit} className="space-y-5 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 sm:p-8">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Restaurant / brand name *">
              <input
                required
                value={form.businessName}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm({ ...form, businessName: v, slug: form.slug || autoSlug(v) });
                }}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
                placeholder="e.g. Tealive"
              />
            </Field>
            <Field label="Slug (URL) *" hint="lowercase, letters/numbers/dashes only">
              <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg overflow-hidden focus-within:border-emerald-500">
                <input
                  required
                  pattern="[a-z0-9-]{2,40}"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                  className="flex-1 px-3 py-2.5 bg-transparent text-slate-100 focus:outline-none"
                  placeholder="tealive"
                />
                <span className="px-3 py-2.5 text-xs text-slate-500 border-l border-slate-700">.foxie-cs.com</span>
              </div>
            </Field>
            <Field label="Owner name *">
              <input
                required
                value={form.ownerName}
                onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </Field>
            <Field label="Owner email *">
              <input
                required
                type="email"
                value={form.ownerEmail}
                onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </Field>
            <Field label="Restaurant phone *">
              <input
                required
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
                placeholder="+60 11-5430 2561"
              />
            </Field>
            <Field label="Cuisine">
              <input
                value={form.cuisine}
                onChange={(e) => setForm({ ...form, cuisine: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
                placeholder="Korean BBQ, Western, café…"
              />
            </Field>
          </div>
          <Field label="Address">
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
              placeholder="Level 8, Millerz Square, Old Klang Road, KL"
            />
          </Field>
          <Field label="Tier *">
            <select
              required
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value as Tier })}
              className="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="starter">Starter (RM 299/mo — 1 channel, 200 voice min)</option>
              <option value="growth">Growth (RM 899/mo — voice + WA, 1,500 min)</option>
              <option value="pro">Pro (RM 2,499/mo — multi-outlet, unlimited)</option>
              <option value="enterprise">Privacy Enterprise (custom)</option>
            </select>
          </Field>

          {result && !result.ok && (
            <div className="text-sm px-4 py-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-200">
              {result.msg}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full px-6 py-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 text-slate-950 font-semibold text-lg"
          >
            {submitting ? "Creating tenant…" : "Start free 30-day trial →"}
          </button>
          <p className="text-xs text-center text-slate-500">
            By signing up you agree to billing after the 30-day trial. Cancel anytime.
          </p>
        </form>
      </main>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
        {label} {hint && <span className="text-slate-500 normal-case font-normal">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}
