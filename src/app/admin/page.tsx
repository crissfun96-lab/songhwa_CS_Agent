"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Stats {
  menu: { total: number; active: number };
  sets: { total: number };
  promos: { total: number; active: number };
  reservations: { recent: number; today: number };
  complaints: { recent: number; open: number };
  callbacks: { recent: number; open: number };
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setStats(d.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-400">Loading…</div>;
  if (!stats) return <div className="text-red-400">Failed to load stats</div>;

  const cards = [
    {
      href: "/admin/menu",
      label: "Menu",
      primary: stats.menu.active,
      secondary: `${stats.menu.total} total`,
      color: "from-emerald-500 to-emerald-700",
    },
    {
      href: "/admin/promos",
      label: "Active Promos",
      primary: stats.promos.active,
      secondary: `${stats.promos.total} total`,
      color: "from-amber-500 to-amber-700",
    },
    {
      href: "/admin/reservations",
      label: "Today's Bookings",
      primary: stats.reservations.today,
      secondary: `${stats.reservations.recent} recent`,
      color: "from-blue-500 to-blue-700",
    },
    {
      href: "/admin/complaints",
      label: "Open Complaints",
      primary: stats.complaints.open,
      secondary: `${stats.complaints.recent} recent`,
      color: stats.complaints.open > 0 ? "from-red-500 to-red-700" : "from-slate-500 to-slate-700",
    },
    {
      href: "/admin/callbacks",
      label: "Open Callbacks",
      primary: stats.callbacks.open,
      secondary: `${stats.callbacks.recent} recent`,
      color: stats.callbacks.open > 0 ? "from-orange-500 to-orange-700" : "from-slate-500 to-slate-700",
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`block rounded-xl p-6 bg-gradient-to-br ${card.color} hover:brightness-110 transition`}
          >
            <div className="text-sm opacity-80">{card.label}</div>
            <div className="text-4xl font-bold mt-2">{card.primary}</div>
            <div className="text-xs opacity-70 mt-1">{card.secondary}</div>
          </Link>
        ))}
      </div>

      <div className="bg-slate-900 rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-3">Quick Links</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <a
            href="/api/menu/config"
            target="_blank"
            rel="noreferrer"
            className="text-slate-300 hover:text-white"
          >
            → View live agent config
          </a>
          <a
            href="/api/menu/promos"
            target="_blank"
            rel="noreferrer"
            className="text-slate-300 hover:text-white"
          >
            → View active promos JSON
          </a>
          <a
            href="/api/business/status"
            target="_blank"
            rel="noreferrer"
            className="text-slate-300 hover:text-white"
          >
            → View business status
          </a>
          <Link href="/" className="text-slate-300 hover:text-white">
            → Voice Agent page
          </Link>
        </div>
      </div>
    </div>
  );
}
