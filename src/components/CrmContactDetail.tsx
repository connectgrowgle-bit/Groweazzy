'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatPaise } from '@/lib/format';

type Detail = {
  contact: {
    id: string;
    email: string;
    fullName: string | null;
    phone: string | null;
    stage: string;
    ownerUserId: string | null;
  };
  activities: { id: string; type: string; fromStage: string | null; toStage: string | null; note: string | null; createdAt: string }[];
  notes: { id: string; body: string; createdAt: string }[];
  tasks: { id: string; title: string; status: string; dueAt: string | null }[];
  orders: { id: string; stage: string; amountPaise: number; service: { name: string }; plan: { name: string } }[];
};

const CRM_STAGES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'ONBOARDING',
  'IN_PROGRESS',
  'REVIEW',
  'DELIVERED',
  'COMPLETED',
  'LOST',
  'CANCELLED',
];

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.formErrors?.[0] ?? body.error ?? `Request failed (${res.status})`);
  return body;
}

export function CrmContactDetail({ contactId }: { contactId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stageValue, setStageValue] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}`);
      if (res.status === 404) {
        setError('Contact not found (or you do not have access).');
        return;
      }
      const data: Detail = await jsonOrThrow(res);
      setDetail(data);
      setStageValue(data.contact.stage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

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

  if (error && !detail) return <p className="text-red-700">{error}</p>;
  if (!detail) return <p className="text-gray-500">Loading…</p>;

  const { contact, activities, notes, tasks, orders } = detail;

  return (
    <div className="space-y-8">
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{contact.fullName ?? contact.email}</h1>
        <p className="text-gray-500">{contact.email}</p>
      </div>

      <div className="rounded-md border border-gray-200 p-4">
        <h2 className="font-medium text-gray-900">Stage</h2>
        <div className="mt-3 flex gap-3">
          <select
            value={stageValue}
            onChange={(e) => setStageValue(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          >
            {CRM_STAGES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || stageValue === contact.stage}
            onClick={() =>
              withBusy(async () => {
                await jsonOrThrow(
                  await fetch(`/api/crm/contacts/${contactId}`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ stage: stageValue }),
                  })
                );
              })
            }
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Update
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Order-driven stages (ONBOARDING onward) also move automatically as the linked order progresses.
        </p>
      </div>

      <div className="rounded-md border border-gray-200 p-4">
        <h2 className="font-medium text-gray-900">Owner</h2>
        <p className="mt-1 text-sm text-gray-500">
          {contact.ownerUserId ? `Assigned (user ${contact.ownerUserId})` : 'Unassigned'}
        </p>
        <div className="mt-3 flex gap-3">
          <input
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
            placeholder="Staff user id"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !ownerUserId}
            onClick={() =>
              withBusy(async () => {
                await jsonOrThrow(
                  await fetch(`/api/crm/contacts/${contactId}/assign`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ ownerUserId }),
                  })
                );
                setOwnerUserId('');
              })
            }
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Assign
          </button>
        </div>
      </div>

      {orders.length > 0 && (
        <div>
          <h2 className="font-medium text-gray-900">Orders</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="text-brand hover:underline">
                  {o.service.name} — {o.plan.name}
                </Link>{' '}
                <span className="text-gray-500">
                  ({o.stage.replace('_', ' ')}, {formatPaise(o.amountPaise)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="font-medium text-gray-900">Tasks</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-gray-200 p-2">
              <span className={t.status === 'DONE' ? 'text-gray-400 line-through' : 'text-gray-900'}>
                {t.title}
                {t.dueAt && <span className="ml-2 text-xs text-gray-500">due {new Date(t.dueAt).toLocaleDateString()}</span>}
              </span>
              {t.status === 'OPEN' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    withBusy(async () => {
                      await jsonOrThrow(
                        await fetch(`/api/crm/tasks/${t.id}`, {
                          method: 'PATCH',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ status: 'DONE' }),
                        })
                      );
                    })
                  }
                  className="shrink-0 text-xs text-brand hover:underline"
                >
                  Mark done
                </button>
              )}
            </li>
          ))}
          {tasks.length === 0 && <li className="text-gray-500">No tasks yet.</li>}
        </ul>
        <div className="mt-3 flex gap-3">
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="New task"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !taskTitle.trim()}
            onClick={() =>
              withBusy(async () => {
                await jsonOrThrow(
                  await fetch('/api/crm/tasks', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ contactId, title: taskTitle }),
                  })
                );
                setTaskTitle('');
              })
            }
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <h2 className="font-medium text-gray-900">Notes</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-gray-200 p-2">
              <div>{n.body}</div>
              <div className="mt-1 text-xs text-gray-400">{new Date(n.createdAt).toLocaleString()}</div>
            </li>
          ))}
          {notes.length === 0 && <li className="text-gray-500">No notes yet.</li>}
        </ul>
        <div className="mt-3 flex gap-3">
          <input
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            placeholder="Add a note"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !noteBody.trim()}
            onClick={() =>
              withBusy(async () => {
                await jsonOrThrow(
                  await fetch(`/api/crm/contacts/${contactId}/notes`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ body: noteBody }),
                  })
                );
                setNoteBody('');
              })
            }
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <h2 className="font-medium text-gray-900">Activity</h2>
        <ul className="mt-2 space-y-1 text-sm text-gray-700">
          {activities.map((a) => (
            <li key={a.id}>
              <span className="text-gray-400">{new Date(a.createdAt).toLocaleString()}</span> — {a.type}
              {a.toStage && ` → ${a.toStage.replace('_', ' ')}`}
              {a.note && ` (${a.note})`}
            </li>
          ))}
          {activities.length === 0 && <li className="text-gray-500">No activity yet.</li>}
        </ul>
      </div>
    </div>
  );
}
