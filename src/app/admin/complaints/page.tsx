"use client";

import { useEffect, useState } from "react";

interface Complaint {
  id: string;
  ticketId: string;
  name: string;
  phone: string;
  category: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "new" | "acknowledged" | "in_progress" | "resolved" | "closed";
  createdAt: string;
  visitDate: string | null;
}

const severityColor = {
  critical: "bg-red-500/30 text-red-300 border-red-500/50",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  low: "bg-slate-500/20 text-slate-400 border-slate-500/40",
};

export default function ComplaintsAdmin() {
  const [items, setItems] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/admin/complaints")
      .then((r) => r.json())
      .then((d) => d.success && setItems(d.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const updateStatus = async (id: string, status: Complaint["status"]) => {
    await fetch(`/api/admin/complaints/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Complaints ({items.length})</h1>

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-slate-900 rounded-lg p-8 text-center text-slate-500">
          No complaints filed. Good job! 👏
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <div
              key={c.id}
              className={`bg-slate-900 border rounded-lg p-4 ${severityColor[c.severity]}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs text-slate-400">{c.ticketId}</code>
                    <span className={`text-xs px-2 py-0.5 rounded uppercase ${severityColor[c.severity]}`}>
                      {c.severity}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {c.status}
                    </span>
                  </div>
                  <h3 className="font-bold mt-2">{c.name}</h3>
                  <div className="text-xs text-slate-400 mt-1">
                    📞 {c.phone} · {c.category.replace(/_/g, " ")}
                    {c.visitDate && ` · visit: ${c.visitDate}`}
                  </div>
                  <p className="text-sm text-slate-200 mt-3 whitespace-pre-wrap">{c.description}</p>
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <span className="text-xs text-slate-500">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                  <select
                    value={c.status}
                    onChange={(e) => updateStatus(c.id, e.target.value as Complaint["status"])}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs"
                  >
                    <option value="new">new</option>
                    <option value="acknowledged">acknowledged</option>
                    <option value="in_progress">in progress</option>
                    <option value="resolved">resolved</option>
                    <option value="closed">closed</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
