"use client";

import { useCallback, useEffect, useState } from "react";

interface Handoff {
  id: string;
  ticketId: string;
  channel: "web" | "phone" | "wa";
  customerName: string;
  customerPhone: string;
  reason: string;
  urgency: "high" | "medium";
  status: "pending" | "transferring" | "human_mode" | "resolved" | "abandoned";
  action: "transfer_now" | "human_mode" | "callback_promised";
  liveTransferTarget?: string;
  startedAt: string;
  resolvedAt: string | null;
  assignedTo: string | null;
}

const CHANNEL_EMOJI = { web: "🌐", phone: "📞", wa: "💬" };
const URGENCY_COLOR = {
  high: "text-red-400 border-red-500/40 bg-red-500/10",
  medium: "text-amber-300 border-amber-500/40 bg-amber-500/10",
};

export default function HandoffsAdmin() {
  const [items, setItems] = useState<Handoff[]>([]);
  const [view, setView] = useState<"open" | "resolved" | "all">("open");
  const [loading, setLoading] = useState(true);
  const [resolveOpen, setResolveOpen] = useState<string | null>(null);
  const [resolveBy, setResolveBy] = useState("staff");
  const [resolveNote, setResolveNote] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/handoffs?status=${view}`)
      .then((r) => r.json())
      .then((d) => d.success && setItems(d.data))
      .finally(() => setLoading(false));
  }, [view]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000); // auto-refresh every 15s for live ops
    return () => clearInterval(id);
  }, [load]);

  const resolve = async (handoffId: string) => {
    setMsg("");
    const res = await fetch(`/api/admin/handoffs/${handoffId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolvedBy: resolveBy || "staff", note: resolveNote || undefined }),
    });
    const j = await res.json();
    if (j.success) {
      setMsg(`✓ Resolved`);
      setResolveOpen(null);
      setResolveNote("");
      load();
    } else {
      setMsg(`✗ ${j.error}`);
    }
  };

  const elapsedMin = (iso: string): number =>
    Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Live Handoffs</h1>
          <p className="text-sm text-slate-400 mt-1">
            Customers asking for a human RIGHT NOW. Auto-refreshes every 15s.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {(["open", "resolved", "all"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              type="button"
              className={`px-3 py-1.5 rounded-md border ${
                view === v
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-200"
                  : "border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </header>

      {msg && (
        <div className="mb-4 text-sm text-slate-300 bg-slate-800/60 border border-slate-700 rounded-md px-3 py-2">
          {msg}
        </div>
      )}

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-slate-500 bg-slate-900/40 border border-slate-800 rounded-lg">
          {view === "open" ? "🎉 No open handoffs. All clear." : "Nothing here."}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((h) => (
            <div
              key={h.id}
              className={`rounded-lg border p-4 ${
                h.status === "resolved"
                  ? "border-slate-800 bg-slate-900/50 opacity-70"
                  : URGENCY_COLOR[h.urgency]
              }`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-[260px]">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xl">{CHANNEL_EMOJI[h.channel]}</span>
                    <code className="text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                      {h.ticketId}
                    </code>
                    <span
                      className={`text-xs px-2 py-0.5 rounded uppercase tracking-wider ${
                        h.urgency === "high"
                          ? "bg-red-500/20 text-red-200"
                          : "bg-amber-500/20 text-amber-200"
                      }`}
                    >
                      {h.urgency}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-800/60 text-slate-300 capitalize">
                      {h.status.replace("_", " ")}
                    </span>
                    {h.status !== "resolved" && (
                      <span className="text-xs text-slate-400">
                        {elapsedMin(h.startedAt)} min ago
                      </span>
                    )}
                  </div>

                  <div className="text-base font-semibold mb-1">{h.customerName}</div>
                  <a
                    href={`tel:${h.customerPhone}`}
                    className="text-sm text-slate-300 hover:text-white underline-offset-2 hover:underline"
                  >
                    {h.customerPhone}
                  </a>
                  <p className="text-sm text-slate-300 mt-2 leading-relaxed">{h.reason}</p>

                  {h.action === "transfer_now" && h.liveTransferTarget && (
                    <p className="text-xs text-emerald-300 mt-2">
                      📞 Voice infra bridging caller to {h.liveTransferTarget}
                    </p>
                  )}
                  {h.action === "human_mode" && h.status !== "resolved" && (
                    <p className="text-xs text-amber-300 mt-2">
                      💬 WhatsApp convo is in HUMAN MODE — open WA, find {h.customerPhone}, reply directly. AI is silent until you resolve.
                    </p>
                  )}
                  {h.action === "callback_promised" && (
                    <p className="text-xs text-blue-300 mt-2">
                      📞 Call back: <a href={`tel:${h.customerPhone}`} className="underline">{h.customerPhone}</a>
                    </p>
                  )}

                  {h.resolvedAt && (
                    <p className="text-xs text-slate-500 mt-2">
                      Resolved by <span className="text-slate-300">{h.assignedTo}</span> at{" "}
                      {new Date(h.resolvedAt).toLocaleString()}
                    </p>
                  )}
                </div>

                {h.status !== "resolved" && (
                  <div className="flex flex-col gap-2 min-w-[140px]">
                    {resolveOpen === h.id ? (
                      <>
                        <input
                          type="text"
                          value={resolveBy}
                          onChange={(e) => setResolveBy(e.target.value)}
                          placeholder="Your name"
                          className="text-xs px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
                        />
                        <textarea
                          value={resolveNote}
                          onChange={(e) => setResolveNote(e.target.value)}
                          placeholder="What did you do?"
                          rows={2}
                          className="text-xs px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:border-emerald-500"
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={() => resolve(h.id)}
                            type="button"
                            className="flex-1 text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white"
                          >
                            ✓ Confirm
                          </button>
                          <button
                            onClick={() => setResolveOpen(null)}
                            type="button"
                            className="text-xs px-2 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                          >
                            cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        onClick={() => setResolveOpen(h.id)}
                        type="button"
                        className="text-xs px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                      >
                        Mark resolved
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
