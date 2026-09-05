'use client';

import { useEffect, useState } from 'react';
import { formatPaise } from '@/lib/format';

type ServiceRow = {
  id: string;
  name: string;
  tagline: string;
  audience: string;
  shortDescription: string;
  longDescriptionHtml: string;
  features: string[];
  howItWorks: string[];
  isActive: string;
};
type PlanRow = { id: string; key: string; name: string; billingNote: string; pricePaise: number; isActive: string };
type PriceHistoryRow = { id: string; oldPricePaise: number; newPricePaise: number; reason: string; createdAt: string };

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.formErrors?.[0] ?? body.error ?? `Request failed (${res.status})`);
  return body;
}

export function AdminServiceEditor({ serviceId }: { serviceId: string }) {
  const [service, setService] = useState<ServiceRow | null>(null);
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    tagline: string;
    audience: string;
    shortDescription: string;
    longDescriptionHtml: string;
    features: string;
    howItWorks: string;
  } | null>(null);
  const [newPlan, setNewPlan] = useState({ key: '', name: '', priceRupees: '', billingNote: '' });
  const [priceForms, setPriceForms] = useState<Record<string, { priceRupees: string; reason: string }>>({});
  const [historyByPlan, setHistoryByPlan] = useState<Record<string, PriceHistoryRow[]>>({});

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/admin/services/${serviceId}`);
      if (res.status === 403) {
        setError("You don't have permission to view this.");
        return;
      }
      if (res.status === 404) {
        setError('Service not found.');
        return;
      }
      const body = await jsonOrThrow(res);
      setService(body.service);
      setPlans(body.plans);
      setForm({
        name: body.service.name,
        tagline: body.service.tagline,
        audience: body.service.audience,
        shortDescription: body.service.shortDescription,
        longDescriptionHtml: body.service.longDescriptionHtml,
        features: body.service.features.join('\n'),
        howItWorks: body.service.howItWorks.join('\n'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory(planId: string) {
    try {
      const res = await fetch(`/api/admin/plans/${planId}/price`);
      const body = await jsonOrThrow(res);
      setHistoryByPlan((prev) => ({ ...prev, [planId]: body.history }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  if (error && !service) return <p className="text-red-700">{error}</p>;
  if (!service || !plans || !form) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="space-y-8">
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">{service.name}</h1>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            withBusy(async () => {
              await jsonOrThrow(
                await fetch(`/api/admin/services/${serviceId}`, {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ isActive: service.isActive === 'true' ? 'false' : 'true' }),
                })
              );
            })
          }
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {service.isActive === 'true' ? 'Deactivate' : 'Activate'}
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          withBusy(async () => {
            await jsonOrThrow(
              await fetch(`/api/admin/services/${serviceId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  name: form.name,
                  tagline: form.tagline,
                  audience: form.audience,
                  shortDescription: form.shortDescription,
                  longDescriptionHtml: form.longDescriptionHtml,
                  features: form.features.split('\n').map((s) => s.trim()).filter(Boolean),
                  howItWorks: form.howItWorks.split('\n').map((s) => s.trim()).filter(Boolean),
                }),
              })
            );
          });
        }}
        className="space-y-3 rounded-md border border-gray-200 p-4"
      >
        <h2 className="font-medium text-gray-900">Copy (service.edit)</h2>
        <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <Field label="Tagline" value={form.tagline} onChange={(v) => setForm({ ...form, tagline: v })} />
        <Field label="Audience" value={form.audience} onChange={(v) => setForm({ ...form, audience: v })} />
        <FieldArea
          label="Short description"
          value={form.shortDescription}
          onChange={(v) => setForm({ ...form, shortDescription: v })}
        />
        <FieldArea
          label="Long description (HTML)"
          value={form.longDescriptionHtml}
          onChange={(v) => setForm({ ...form, longDescriptionHtml: v })}
        />
        <FieldArea
          label="Features (one per line)"
          value={form.features}
          onChange={(v) => setForm({ ...form, features: v })}
          rows={4}
        />
        <FieldArea
          label="How it works (one per line)"
          value={form.howItWorks}
          onChange={(v) => setForm({ ...form, howItWorks: v })}
          rows={4}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Save copy
        </button>
      </form>

      <div className="space-y-4">
        <h2 className="font-medium text-gray-900">Plans & pricing (service.pricing)</h2>
        {plans.map((plan) => {
          const priceForm = priceForms[plan.id] ?? { priceRupees: '', reason: '' };
          return (
            <div key={plan.id} className="rounded-md border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-900">{plan.name}</span>{' '}
                  <span className="text-xs text-gray-400">({plan.key})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={plan.isActive === 'true' ? 'text-xs text-green-700' : 'text-xs text-gray-400'}>
                    {plan.isActive === 'true' ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      withBusy(async () => {
                        await jsonOrThrow(
                          await fetch(`/api/admin/plans/${plan.id}`, {
                            method: 'PATCH',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ isActive: plan.isActive === 'true' ? 'false' : 'true' }),
                          })
                        );
                      })
                    }
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                  >
                    {plan.isActive === 'true' ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>

              <div className="mt-2 text-sm text-gray-700">
                Current price: <span className="font-medium">{formatPaise(plan.pricePaise)}</span> ({plan.billingNote})
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const rupees = Number(priceForm.priceRupees);
                  withBusy(async () => {
                    await jsonOrThrow(
                      await fetch(`/api/admin/plans/${plan.id}/price`, {
                        method: 'PATCH',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ pricePaise: Math.round(rupees * 100), reason: priceForm.reason }),
                      })
                    );
                    setPriceForms((prev) => ({ ...prev, [plan.id]: { priceRupees: '', reason: '' } }));
                  });
                }}
                className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4"
              >
                <input
                  value={priceForm.priceRupees}
                  onChange={(e) =>
                    setPriceForms((prev) => ({ ...prev, [plan.id]: { ...priceForm, priceRupees: e.target.value } }))
                  }
                  placeholder="New price (₹)"
                  type="number"
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <input
                  value={priceForm.reason}
                  onChange={(e) => setPriceForms((prev) => ({ ...prev, [plan.id]: { ...priceForm, reason: e.target.value } }))}
                  placeholder="Reason (required)"
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm sm:col-span-2"
                />
                <button
                  type="submit"
                  disabled={busy || !priceForm.priceRupees || !priceForm.reason.trim()}
                  className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  Change price
                </button>
              </form>

              <button
                type="button"
                onClick={() => loadHistory(plan.id)}
                className="mt-2 text-xs text-brand hover:underline"
              >
                {historyByPlan[plan.id] ? 'Refresh price history' : 'Show price history'}
              </button>
              {(() => {
                const history = historyByPlan[plan.id];
                if (!history) return null;
                return (
                  <ul className="mt-2 space-y-1 text-xs text-gray-600">
                    {history.length === 0 && <li>No price changes yet.</li>}
                    {history.map((h) => (
                      <li key={h.id}>
                        {new Date(h.createdAt).toLocaleDateString()}: {formatPaise(h.oldPricePaise)} → {formatPaise(h.newPricePaise)} — {h.reason}
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          );
        })}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            withBusy(async () => {
              await jsonOrThrow(
                await fetch(`/api/admin/services/${serviceId}/plans`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    key: newPlan.key,
                    name: newPlan.name,
                    pricePaise: Math.round(Number(newPlan.priceRupees) * 100),
                    billingNote: newPlan.billingNote,
                  }),
                })
              );
              setNewPlan({ key: '', name: '', priceRupees: '', billingNote: '' });
            });
          }}
          className="grid grid-cols-1 gap-2 rounded-md border border-gray-200 p-4 sm:grid-cols-5"
        >
          <input
            value={newPlan.key}
            onChange={(e) => setNewPlan((p) => ({ ...p, key: e.target.value }))}
            placeholder="key (e.g. plan-premium)"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            value={newPlan.name}
            onChange={(e) => setNewPlan((p) => ({ ...p, name: e.target.value }))}
            placeholder="Name"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            value={newPlan.priceRupees}
            onChange={(e) => setNewPlan((p) => ({ ...p, priceRupees: e.target.value }))}
            placeholder="Price (₹)"
            type="number"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            value={newPlan.billingNote}
            onChange={(e) => setNewPlan((p) => ({ ...p, billingNote: e.target.value }))}
            placeholder="Billing note"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !newPlan.key.trim() || !newPlan.name.trim() || !newPlan.priceRupees}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Add plan
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  );
}

function FieldArea({
  label,
  value,
  onChange,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
