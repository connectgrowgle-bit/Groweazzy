'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Contact = {
  id: string;
  email: string;
  fullName: string | null;
  stage: string;
  updatedAt: string;
};

const STAGE_ORDER = [
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

export function CrmPipeline() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/crm/contacts');
        if (res.status === 403) {
          setError("You don't have access to the CRM.");
          return;
        }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        setContacts(body.contacts);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    }
    load();
  }, []);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!contacts) return <p className="text-gray-500">Loading…</p>;

  const byStage = new Map<string, Contact[]>();
  for (const contact of contacts) {
    const list = byStage.get(contact.stage) ?? [];
    list.push(contact);
    byStage.set(contact.stage, list);
  }

  const nonEmptyStages = STAGE_ORDER.filter((stage) => (byStage.get(stage)?.length ?? 0) > 0);

  if (nonEmptyStages.length === 0) return <p className="text-gray-500">No contacts yet.</p>;

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {nonEmptyStages.map((stage) => (
        <div key={stage} className="w-64 shrink-0 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {stage.replace('_', ' ')} ({byStage.get(stage)?.length})
          </div>
          <div className="space-y-2">
            {byStage.get(stage)?.map((contact) => (
              <Link
                key={contact.id}
                href={`/crm/${contact.id}`}
                className="block rounded-md border border-gray-200 bg-white p-3 text-sm hover:border-brand"
              >
                <div className="font-medium text-gray-900">{contact.fullName ?? contact.email}</div>
                <div className="text-gray-500">{contact.email}</div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
