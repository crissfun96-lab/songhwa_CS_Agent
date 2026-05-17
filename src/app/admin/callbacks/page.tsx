"use client";

import { useEffect, useState } from "react";

interface Callback {
  id: string;
  ticketId: string;
  name: string;
  phone: string;
  reason: string;
  urgency: "low" | "medium" | "high";
  status: "queued" | "in_progress" | "completed" | "missed" | "cancelled";
  promiseByIso: string;
  createdAt: string;
}

const urgencyColor = {
  high: "bg-red-500/20 text-red-400 border-red-500/40",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  low: "bg-slate-500/20 text-slate-400 border-slate-500/40",
};

export default function CallbacksAdmin() {
  const [items, setItems] = useState<Callback[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/admin/callbacks")
      .then((r) => r.json())
      .then((d) => d.success && setItems(d.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const updateStatus = async (id: string, status: Callback["status"]) => {
    await fetch(`/api/admin/callbacks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Callback Queue ({items.length})</h1>

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-slate-900 rounded-lg p-8 text-center text-slate-500">
          No callbacks queued.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((c) => {
            const overdue = new Date(c.promiseByIso) < new Date() && c.status === "queued";
            return (
              <div
                key={c.id}
                className={`bg-slate-900 border rounded-lg p-4 ${urgencyColor[c.urgency]} ${
                  overdue ? "ring-2 ring-red-500/50" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs text-slate-400">{c.ticketId}</code>
                      <span className={`text-xs px-2 py-0.5 rounded uppercase ${urgencyColor[c.urgency]}`}>
                        {c.urgency}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {c.status}
                      </span>
                      {overdue && (
                        <span className="text-xs px-2 py-0.5 rounded bg-red-500/30 text-red-300 font-bold">
                          OVERDUE
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold mt-2">{c.name} — <a href={`tel:${c.phone}`} className="text-emerald-400">{c.phone}</a></h3>
                    <p className="text-sm text-slate-200 mt-2">{c.reason}</p>
                    <div className="text-xs text-slate-500 mt-2">
                      Promised by {new Date(c.promiseByIso).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <span className="text-xs text-slate-500">
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                    <select
                      value={c.status}
                      onChange={(e) => updateStatus(c.id, e.target.value as Callback["status"])}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs"
                    >
                      <option value="queued">queued</option>
                      <option value="in_progress">in progress</option>
                      <option value="completed">completed</option>
                      <option value="missed">missed</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
