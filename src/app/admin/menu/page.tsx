"use client";

import { useEffect, useMemo, useState } from "react";

interface MenuItem {
  id: string;
  code: string | null;
  names: { en: string; zh?: string; ko?: string; bm?: string };
  priceRm: number;
  category: string;
  portionDescription: string;
  allergens: string[];
  spiceLevel: number;
  isSignature: boolean;
  isPopular: boolean;
  isActive: boolean;
  description: { en: string };
  tags: string[];
  updatedAt: string;
}

const CATEGORIES = [
  "bbq", "stew_soup", "rice_noodles", "appetizer_side",
  "pancake", "fried_chicken", "dessert", "beverage", "add_on",
];

export default function MenuAdmin() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "signature" | "popular">("active");
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string>("");

  const load = () => {
    setLoading(true);
    fetch("/api/admin/menu")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setItems(d.data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let result = items;
    if (filter === "active") result = result.filter((i) => i.isActive);
    if (filter === "inactive") result = result.filter((i) => !i.isActive);
    if (filter === "signature") result = result.filter((i) => i.isSignature);
    if (filter === "popular") result = result.filter((i) => i.isPopular);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.id.includes(q) ||
          i.names.en.toLowerCase().includes(q) ||
          i.category.includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [items, filter, search]);

  const saveItem = async (item: MenuItem) => {
    const res = await fetch(`/api/admin/menu/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        price_rm: item.priceRm,
        name_en: item.names.en,
        category: item.category,
        portion: item.portionDescription,
        allergens: item.allergens,
        spice_level: item.spiceLevel,
        is_signature: item.isSignature,
        is_popular: item.isPopular,
        is_active: item.isActive,
        description_en: item.description.en,
        tags: item.tags,
      }),
    });
    const j = await res.json();
    if (j.success) {
      setMessage(`✓ Saved ${item.names.en}`);
      setEditing(null);
      load();
    } else {
      setMessage(`✗ Error: ${j.error}`);
    }
    setTimeout(() => setMessage(""), 3000);
  };

  const quickToggle = async (id: string, field: "isSignature" | "isPopular" | "isActive", value: boolean) => {
    const payload: Record<string, unknown> = {};
    if (field === "isSignature") payload.is_signature = value;
    if (field === "isPopular") payload.is_popular = value;
    if (field === "isActive") payload.is_active = value;

    await fetch(`/api/admin/menu/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    load();
  };

  const createItem = async (data: {
    id: string;
    name_en: string;
    price_rm: number;
    category: string;
  }) => {
    const res = await fetch("/api/admin/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const j = await res.json();
    if (j.success) {
      setMessage(`✓ Created ${data.name_en}`);
      setCreating(false);
      load();
    } else {
      setMessage(`✗ Error: ${j.error}`);
    }
    setTimeout(() => setMessage(""), 3000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold">Menu Items ({filtered.length})</h1>
        <button
          onClick={() => setCreating(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + Add Item
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          placeholder="Search by name, id, tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
        >
          <option value="active">Active only</option>
          <option value="all">All</option>
          <option value="inactive">Inactive</option>
          <option value="signature">Signature</option>
          <option value="popular">Popular</option>
        </select>
      </div>

      {message && (
        <div className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm">
          {message}
        </div>
      )}

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : (
        <div className="bg-slate-900 rounded-lg overflow-hidden border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-300 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">ID</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-right px-3 py-2">Price</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-center px-3 py-2">Spice</th>
                <th className="text-center px-3 py-2">Sig</th>
                <th className="text-center px-3 py-2">Pop</th>
                <th className="text-center px-3 py-2">Active</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  className={`border-t border-slate-800 hover:bg-slate-800/50 ${
                    !item.isActive ? "opacity-40" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-slate-400 font-mono text-xs">{item.id}</td>
                  <td className="px-3 py-2">{item.names.en}</td>
                  <td className="px-3 py-2 text-right font-mono">RM {item.priceRm.toFixed(2)}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{item.category}</td>
                  <td className="px-3 py-2 text-center">{"🌶".repeat(item.spiceLevel)}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => quickToggle(item.id, "isSignature", !item.isSignature)}
                      className="text-xs"
                    >
                      {item.isSignature ? "⭐" : "·"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => quickToggle(item.id, "isPopular", !item.isPopular)}
                      className="text-xs"
                    >
                      {item.isPopular ? "🔥" : "·"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => quickToggle(item.id, "isActive", !item.isActive)}
                      className="text-xs"
                    >
                      {item.isActive ? "✓" : "✗"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setEditing(item)}
                      className="text-emerald-400 hover:text-emerald-300 text-xs"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditModal item={editing} onClose={() => setEditing(null)} onSave={saveItem} />}
      {creating && <CreateModal onClose={() => setCreating(false)} onCreate={createItem} />}
    </div>
  );
}

// ── Edit Modal ──────────────────────────────────────────────
function EditModal({
  item,
  onClose,
  onSave,
}: {
  item: MenuItem;
  onClose: () => void;
  onSave: (item: MenuItem) => void;
}) {
  const [draft, setDraft] = useState(item);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-bold">Edit {item.id}</h2>
            <p className="text-xs text-slate-400">Last updated: {new Date(item.updatedAt).toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-2xl">
            ×
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Name (English)">
            <input
              type="text"
              value={draft.names.en}
              onChange={(e) => setDraft({ ...draft, names: { ...draft.names, en: e.target.value } })}
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (RM)">
              <input
                type="number"
                step="0.01"
                value={draft.priceRm}
                onChange={(e) => setDraft({ ...draft, priceRm: Number(e.target.value) })}
                className="input"
              />
            </Field>
            <Field label="Category">
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="input"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Portion">
              <input
                type="text"
                value={draft.portionDescription}
                onChange={(e) => setDraft({ ...draft, portionDescription: e.target.value })}
                className="input"
                placeholder="e.g. 150g"
              />
            </Field>
            <Field label="Spice Level">
              <select
                value={draft.spiceLevel}
                onChange={(e) => setDraft({ ...draft, spiceLevel: Number(e.target.value) })}
                className="input"
              >
                <option value={0}>0 — None</option>
                <option value={1}>1 — Mild</option>
                <option value={2}>2 — Spicy</option>
                <option value={3}>3 — Very Spicy</option>
              </select>
            </Field>
          </div>

          <Field label="Description">
            <textarea
              value={draft.description.en}
              onChange={(e) => setDraft({ ...draft, description: { ...draft.description, en: e.target.value } })}
              className="input h-20"
            />
          </Field>

          <Field label="Allergens (comma-separated)">
            <input
              type="text"
              value={draft.allergens.join(", ")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  allergens: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
              className="input"
              placeholder="pork, sesame, soy"
            />
          </Field>

          <Field label="Tags (comma-separated)">
            <input
              type="text"
              value={draft.tags.join(", ")}
              onChange={(e) =>
                setDraft({ ...draft, tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
              }
              className="input"
            />
          </Field>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isSignature}
                onChange={(e) => setDraft({ ...draft, isSignature: e.target.checked })}
              />
              ⭐ Signature
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isPopular}
                onChange={(e) => setDraft({ ...draft, isPopular: e.target.checked })}
              />
              🔥 Popular
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              />
              ✓ Active
            </label>
          </div>
        </div>

        <div className="flex gap-2 mt-6 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
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

// ── Create Modal ────────────────────────────────────────────
function CreateModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: { id: string; name_en: string; price_rm: number; category: string }) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("bbq");

  const canSubmit = id && name && price && !isNaN(Number(price));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-lg font-bold">New Menu Item</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-2xl">×</button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-slate-400">ID (lowercase, no spaces)</span>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1 text-white"
              placeholder="e.g. new_dish_id"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1 text-white"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Price (RM)</span>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1 text-white"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1 text-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-2 mt-6 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">
            Cancel
          </button>
          <button
            onClick={() => canSubmit && onCreate({ id, name_en: name, price_rm: Number(price), category })}
            disabled={!canSubmit}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
