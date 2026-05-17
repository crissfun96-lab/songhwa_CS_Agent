import type { ReactNode } from "react";
import Link from "next/link";

export const metadata = {
  title: "Songhwa Admin",
};

const navItems = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/handoffs", label: "🚨 Handoffs" },
  { href: "/admin/reservations", label: "Reservations" },
  { href: "/admin/menu", label: "Menu" },
  { href: "/admin/promos", label: "Promos" },
  { href: "/admin/complaints", label: "Complaints" },
  { href: "/admin/callbacks", label: "Callbacks" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6 overflow-x-auto">
          <Link href="/admin" className="font-bold text-lg whitespace-nowrap">
            松花 Admin
          </Link>
          <nav className="flex gap-4 text-sm">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-slate-300 hover:text-white whitespace-nowrap"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <Link
              href="/"
              className="text-xs text-slate-400 hover:text-white whitespace-nowrap"
            >
              → Voice Agent
            </Link>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
