"use client";

import { useEffect, useState } from "react";

interface Promo {
  id: string;
  name: string;
  description: { en: string };
  discountType: string;
  discountValue: number;
  appliesTo: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export default function PromosAdmin() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/admin/promos")
      .then((r) => r.json())
      .then((d) => d.success && setPromos(d.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  const toggleActive = async (id: string, active: boolean) => {
    await fetch(`/api/admin/promos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: active }),
    });
    load();
  };

  const createPromo = async (data: {
    id: string;
    name: string;
    description_en: string;
    discount_type: string;
    start_date: string;
    end_date: string;
  }) => {
    const res = await fetch("/api/admin/promos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const j = await res.json();
    if (j.success) {
      setMsg(`✓ Created ${data.name}`);
      setCreating(false);
      load();
    } else {
      setMsg(`✗ ${j.error}`);
    }
    setTimeout(() => setMsg(""), 3000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Promos ({promos.length})</h1>
        <button
          onClick={() => setCreating(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm"
        >
          + New Promo
        </button>
      </div>

      {msg && <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm">{msg}</div>}

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : (
        <div className="space-y-3">
          {promos.map((p) => {
            const expired = p.endDate < today;
            const upcoming = p.startDate > today;
            const status = !p.isActive ? "disabled" : expired ? "expired" : upcoming ? "upcoming" : "live";
            const statusColor = {
              live: "bg-emerald-500/20 text-emerald-400",
              expired: "bg-slate-500/20 text-slate-400",
              upcoming: "bg-blue-500/20 text-blue-400",
              disabled: "bg-red-500/20 text-red-400",
            }[status];

            return (
              <div
                key={p.id}
                className={`bg-slate-900 border border-slate-800 rounded-lg p-4 ${
                  !p.isActive || expired ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold">{p.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${statusColor}`}>{status}</span>
                    </div>
                    <p className="text-sm text-slate-400 mt-1">{p.description.en}</p>
                    <div className="flex gap-4 text-xs text-slate-500 mt-2">
                      <span>📅 {p.startDate} → {p.endDate}</span>
                      <span>Type: {p.discountType}</span>
                      {p.discountValue > 0 && <span>Value: {p.discountValue}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleActive(p.id, !p.isActive)}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    {p.isActive ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && <CreatePromoModal onClose={() => setCreating(false)} onCreate={createPromo} />}
    </div>
  );
}

function CreatePromoModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: {
    id: string;
    name: string;
    description_en: string;
    discount_type: string;
    start_date: string;
    end_date: string;
  }) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [type, setType] = useState("percent");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md">
        <div className="flex justify-between mb-4">
          <h2 className="text-lg font-bold">New Promo</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-2xl">×</button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-slate-400">ID</span>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              placeholder="e.g. may_weekend_bogo"
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Description</span>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1 h-20"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Discount Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1"
            >
              <option value="percent">Percent off</option>
              <option value="fixed_amount">Fixed RM off</option>
              <option value="bogo">Buy-one-get-one</option>
              <option value="free_item">Free item</option>
              <option value="set_price">Fixed price set</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400">Start</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400">End</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1"
              />
            </label>
          </div>
        </div>

        <div className="flex gap-2 mt-6 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400">Cancel</button>
          <button
            onClick={() =>
              id && name && endDate &&
              onCreate({ id, name, description_en: desc, discount_type: type, start_date: startDate, end_date: endDate })
            }
            disabled={!id || !name || !endDate}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
