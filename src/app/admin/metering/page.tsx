"use client";

import { useEffect, useState } from "react";

interface UsageData {
  tenant: { id: string; name: string; tier: string; status: string; priceMyr: number };
  ym: string;
  usage: Record<string, number>;
  limits: { voiceMinutes: number; waConversations: number; outlets: number };
  utilization: { voicePct: number; waPct: number };
}

export default function MeteringPage() {
  const [tenantId, setTenantId] = useState("songhwa");
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/metering?tenantId=${tenantId}`)
      .then((r) => r.json())
      .then((d) => d.success && setData(d.data))
      .finally(() => setLoading(false));
  }, [tenantId]);

  const utilColor = (pct: number) =>
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Usage & Billing</h1>
        <p className="text-sm text-slate-400 mt-1">
          This month&apos;s usage rolled up daily by cron. Live counts may lag up to 24h.
        </p>
      </header>

      <div className="mb-6">
        <label className="text-xs text-slate-400 mr-2">Tenant:</label>
        <input
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value.toLowerCase())}
          className="px-3 py-1.5 rounded bg-slate-800 border border-slate-700 text-sm w-48 focus:outline-none focus:border-emerald-500"
        />
      </div>

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : !data ? (
        <div className="text-red-400">Tenant not found.</div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card label="Tenant">
              <div className="text-xl font-bold">{data.tenant.name}</div>
              <div className="text-xs text-slate-400 mt-1">
                {data.tenant.tier} · {data.tenant.status}
              </div>
            </Card>
            <Card label="This month (RM)">
              <div className="text-xl font-bold">RM {data.tenant.priceMyr}</div>
              <div className="text-xs text-slate-400 mt-1">{data.ym}</div>
            </Card>
            <Card label="Voice usage">
              <div className="text-xl font-bold">
                {data.usage.voiceMinutes.toFixed(0)} / {data.limits.voiceMinutes > 0 ? data.limits.voiceMinutes : "∞"} min
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full ${utilColor(data.utilization.voicePct)}`}
                  style={{ width: `${Math.min(100, data.utilization.voicePct)}%` }}
                />
              </div>
            </Card>
            <Card label="WhatsApp">
              <div className="text-xl font-bold">
                {data.usage.waOutbound} / {data.limits.waConversations > 0 ? data.limits.waConversations : "∞"} msgs
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full ${utilColor(data.utilization.waPct)}`}
                  style={{ width: `${Math.min(100, data.utilization.waPct)}%` }}
                />
              </div>
            </Card>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Mini label="Reservations" value={data.usage.reservations} />
            <Mini label="Tool calls" value={data.usage.toolCalls} />
            <Mini label="WA inbound" value={data.usage.waInbound} />
            <Mini label="Handoffs" value={data.usage.handoffs} />
            <Mini label="Complaints" value={data.usage.complaints} />
            <Mini label="Callbacks" value={data.usage.callbacks} />
            <Mini label="Leads captured" value={data.usage.leads} />
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4">
      <div className="text-xs uppercase tracking-widest text-slate-400 mb-2">{label}</div>
      {children}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-900/40 border border-slate-800 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}
