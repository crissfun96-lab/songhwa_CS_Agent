"use client";

import { useEffect, useMemo, useState } from "react";

interface Modification {
  at: string;
  by: "agent" | "admin" | "customer";
  actor?: string;
  reason?: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

interface Reservation {
  id: string;
  name: string;
  phone: string;
  date: string;
  time: string;
  pax: number;
  menuChoice: string;
  remarks: string;
  createdAt: string;
  status?: "confirmed" | "cancelled" | "completed" | "no_show";
  modifications?: Modification[];
  cancelledAt?: string;
  cancelReason?: string;
}

export default function ReservationsAdmin() {
  const [items, setItems] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "upcoming" | "today" | "cancelled">("upcoming");
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [msg, setMsg] = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/admin/reservations")
      .then((r) => r.json())
      .then((d) => d.success && setItems(d.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    let arr = items;
    if (filter === "today") arr = arr.filter((r) => r.date === today && r.status !== "cancelled");
    else if (filter === "upcoming") arr = arr.filter((r) => r.date >= today && r.status !== "cancelled");
    else if (filter === "cancelled") arr = arr.filter((r) => r.status === "cancelled");
    return arr;
  }, [items, filter, today]);

  const saveEdit = async (updates: Partial<Reservation>) => {
    if (!editing) return;
    const body: Record<string, unknown> = { reason: "Edited by admin" };
    if (updates.name !== undefined) body.name = updates.name;
    if (updates.date !== undefined) body.date = updates.date;
    if (updates.time !== undefined) body.time = updates.time;
    if (updates.pax !== undefined) body.pax = updates.pax;
    if (updates.menuChoice !== undefined) body.menuChoice = updates.menuChoice;
    if (updates.remarks !== undefined) body.remarks = updates.remarks;
    body.skipAvailabilityCheck = true;  // admin can override

    const res = await fetch(`/api/admin/reservations/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (j.success) {
      setMsg(`✓ Updated ${editing.name}`);
      setEditing(null);
      load();
    } else {
      setMsg(`✗ ${j.error}`);
    }
    setTimeout(() => setMsg(""), 3000);
  };

  const cancelReservation = async (r: Reservation) => {
    if (!confirm(`Cancel ${r.name}'s booking for ${r.date} at ${r.time}?`)) return;
    const reason = prompt("Cancellation reason (optional):") ?? "";
    const res = await fetch(`/api/admin/reservations/${r.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const j = await res.json();
    if (j.success) {
      setMsg(`✓ Cancelled ${r.name}`);
      load();
    } else {
      setMsg(`✗ ${j.error}`);
    }
    setTimeout(() => setMsg(""), 3000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reservations ({filtered.length})</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
        >
          <option value="upcoming">Upcoming</option>
          <option value="today">Today</option>
          <option value="all">All active</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {msg && <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm">{msg}</div>}

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900 rounded-lg p-8 text-center text-slate-500">No reservations.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const cancelled = r.status === "cancelled";
            return (
              <div
                key={r.id}
                className={`bg-slate-900 border border-slate-800 rounded-lg p-4 ${cancelled ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold">{r.name}</h3>
                      <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                        {r.pax} pax
                      </span>
                      {cancelled && (
                        <span className="text-xs bg-red-500/30 text-red-300 px-2 py-0.5 rounded">
                          CANCELLED
                        </span>
                      )}
                      {r.modifications && r.modifications.length > 0 && !cancelled && (
                        <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">
                          ✏️ {r.modifications.length} edit{r.modifications.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-300 mt-1 space-y-0.5">
                      <div>📅 {r.date} at {r.time}</div>
                      <div>
                        📞 <a href={`tel:${r.phone}`} className="text-emerald-400">{r.phone}</a>
                      </div>
                      {r.menuChoice && <div>🍽️ {r.menuChoice}</div>}
                      {r.remarks && <div>📝 {r.remarks}</div>}
                      {r.cancelReason && <div className="text-red-400 text-xs">Cancel reason: {r.cancelReason}</div>}
                    </div>
                    {r.modifications && r.modifications.length > 0 && (
                      <details className="mt-2 text-xs">
                        <summary className="text-slate-400 cursor-pointer">History ({r.modifications.length})</summary>
                        <ul className="mt-1 space-y-1 text-slate-500 pl-3">
                          {r.modifications.map((m, i) => (
                            <li key={i}>
                              [{new Date(m.at).toLocaleString()}] by {m.by}: {Object.keys(m.changes).join(", ")}
                              {m.reason ? ` — ${m.reason}` : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <div className="text-xs text-slate-500">
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                    {!cancelled && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => setEditing(r)}
                          className="text-xs text-emerald-400 hover:text-emerald-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => cancelReservation(r)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <EditModal reservation={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}
    </div>
  );
}

function EditModal({
  reservation,
  onClose,
  onSave,
}: {
  reservation: Reservation;
  onClose: () => void;
  onSave: (updates: Partial<Reservation>) => void;
}) {
  const [name, setName] = useState(reservation.name);
  const [date, setDate] = useState(reservation.date);
  const [time, setTime] = useState(reservation.time);
  const [pax, setPax] = useState(reservation.pax);
  const [menuChoice, setMenuChoice] = useState(reservation.menuChoice);
  const [remarks, setRemarks] = useState(reservation.remarks);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-bold">Edit Reservation</h2>
            <p className="text-xs text-slate-400">{reservation.phone}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-2xl">×</button>
        </div>

        <div className="space-y-3">
          <F label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></F>
          <div className="grid grid-cols-2 gap-3">
            <F label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></F>
            <F label="Time"><input className="input" value={time} onChange={(e) => setTime(e.target.value)} placeholder="7:00 PM" /></F>
          </div>
          <F label="Pax"><input type="number" className="input" value={pax} onChange={(e) => setPax(Number(e.target.value))} min={1} /></F>
          <F label="Menu Choice"><input className="input" value={menuChoice} onChange={(e) => setMenuChoice(e.target.value)} /></F>
          <F label="Remarks"><textarea className="input h-20" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></F>
        </div>

        <div className="flex gap-2 mt-6 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400">Cancel</button>
          <button
            onClick={() => onSave({ name, date, time, pax, menuChoice, remarks })}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm"
          >
            Save
          </button>
        </div>

        <style>{`
          .input { width: 100%; background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 6px 10px; font-size: 13px; color: white; }
          .input:focus { outline: none; border-color: #059669; }
        `}</style>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
