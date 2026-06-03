// Shared shell for the legal/policy pages (/privacy, /pdpa, /terms).
// Server component — static content, no client JS. Dark-slate theme to match
// /business + /business/welcome. Mobile-first, high-contrast for long-form reading.

import type { ReactNode } from "react";

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/pdpa", label: "PDPA Notice" },
  { href: "/terms", label: "Terms of Service" },
] as const;

export function LegalLayout({
  title,
  intro,
  lastUpdated,
  children,
}: {
  title: string;
  intro: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-200">
      <header className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2 font-bold text-base text-slate-100">
          <span className="text-xl">🦊</span>
          <span>Songhwa <span className="text-slate-400 font-normal">· Foxie AI Receptionist</span></span>
        </a>
        <a href="/" className="text-sm text-slate-400 hover:text-slate-200">← Home</a>
      </header>

      <main className="max-w-3xl mx-auto px-6 pt-6 pb-24">
        <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight">{title}</h1>
        <p className="mt-3 text-base text-slate-300 leading-relaxed">{intro}</p>
        <p className="mt-2 text-xs uppercase tracking-widest text-slate-500">
          Last updated: {lastUpdated}
        </p>

        {/* Honesty banner — these are operator-drafted templates, not vetted legal advice. */}
        <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90 leading-relaxed">
          <strong className="text-amber-200">Please have this reviewed.</strong> This document is a
          plain-language starting template prepared by the business, not legal advice. Before relying
          on it, have it reviewed by a Malaysian lawyer or data-protection adviser.
        </div>

        <div className="mt-8 space-y-8">{children}</div>

        <nav className="mt-14 border-t border-slate-800 pt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {LEGAL_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-slate-400 hover:text-emerald-300">
              {l.label}
            </a>
          ))}
          <a href="/" className="text-slate-400 hover:text-emerald-300">Home</a>
        </nav>
      </main>
    </div>
  );
}

// ── Content primitives (keep page files readable + consistently styled) ──────

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-white mb-3">{heading}</h2>
      <div className="space-y-3 text-[15px] text-slate-300 leading-relaxed">{children}</div>
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="leading-relaxed">{children}</p>;
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc pl-5 space-y-2 marker:text-slate-500">
      {items.map((it, i) => (
        <li key={i} className="leading-relaxed">{it}</li>
      ))}
    </ul>
  );
}
