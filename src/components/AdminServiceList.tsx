'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Service = { id: string; slug: string; name: string; isActive: string };

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.formErrors?.[0] ?? body.error ?? `Request failed (${res.status})`);
  return body;
}

export function AdminServiceList() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ slug: '', name: '', shortDescription: '', longDescriptionHtml: '' });

  async function load() {
    setError(null);
    try {
      const res = await fetch('/api/admin/services');
      if (res.status === 403) {
        setError("You don't have permission to view the service catalogue.");
        return;
      }
      const body = await jsonOrThrow(res);
      setServices(body.services);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await jsonOrThrow(
        await fetch('/api/admin/services', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(form),
        })
      );
      setForm({ slug: '', name: '', shortDescription: '', longDescriptionHtml: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (error && !services) return <p className="text-red-700">{error}</p>;
  if (!services) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="space-y-6">
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <ul className="space-y-2">
        {services.map((s) => (
          <li key={s.id}>
            <Link
              href={`/admin/services/${s.id}`}
              className="flex items-center justify-between rounded-md border border-gray-200 p-3 text-sm hover:border-brand"
            >
              <span className="font-medium text-gray-900">{s.name}</span>
              <span className={s.isActive === 'true' ? 'text-green-700' : 'text-gray-400'}>
                {s.isActive === 'true' ? 'Active' : 'Inactive'}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="space-y-3 rounded-md border border-gray-200 p-4">
        <h2 className="font-medium text-gray-900">New service</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            placeholder="slug (e.g. seo-audits)"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Name"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <textarea
          value={form.shortDescription}
          onChange={(e) => setForm((f) => ({ ...f, shortDescription: e.target.value }))}
          placeholder="Short description"
          rows={2}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <textarea
          value={form.longDescriptionHtml}
          onChange={(e) => setForm((f) => ({ ...f, longDescriptionHtml: e.target.value }))}
          placeholder="Long description (HTML)"
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !form.slug.trim() || !form.name.trim()}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Create
        </button>
      </form>
    </div>
  );
}
