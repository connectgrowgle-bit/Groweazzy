'use client';

import { useEffect, useState } from 'react';
import { getOnboardingFieldSpecs, type OnboardingFieldSpec } from '@/lib/onboarding-schemas';
import { formatPaise } from '@/lib/format';

type OrderDetail = {
  order: { id: string; stage: string; amountPaise: number; requirementsLockedAt: string | null };
  service: { slug: string; name: string };
  plan: { name: string; pricePaise: number };
  payment: { id: string; status: string } | null;
  onboarding: { data: Record<string, unknown>; isDraft: boolean; submittedAt: string | null } | null;
  meetings: { id: string; scheduledAt: string; meetingLink: string | null }[];
  isOwner: boolean;
  permissions: { updateStage: boolean; scheduleMeeting: boolean; cancel: boolean };
};

const STAGE_LABELS: Record<string, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  ONBOARDING: 'Onboarding',
  MEETING_SCHEDULED: 'Meeting scheduled',
  REQUIREMENTS_LOCKED: 'Requirements locked',
  TEAM_ASSIGNED: 'Team assigned',
  IN_PROGRESS: 'In progress',
  REVIEW: 'In review',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.formErrors?.[0] ?? body.error ?? `Request failed (${res.status})`);
  return body;
}

// Field values live in the form as strings (and string[] for multiselect) —
// converted to the shape onboarding-schemas.ts expects only at save/submit
// time, per field kind.
function coerceFieldValue(spec: OnboardingFieldSpec, raw: string | string[] | undefined): unknown {
  if (raw === undefined) return undefined;
  if (spec.kind === 'multiselect') return raw;
  if (spec.kind === 'number') return raw === '' ? undefined : Number(raw);
  return raw === '' ? undefined : raw;
}

function fieldValueToFormValue(spec: OnboardingFieldSpec, value: unknown): string | string[] {
  if (value === undefined || value === null) return spec.kind === 'multiselect' ? [] : '';
  if (spec.kind === 'multiselect') return Array.isArray(value) ? (value as string[]) : [];
  return String(value);
}

export function OrderWorkspace({ orderId }: { orderId: string }) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string | string[]>>({});
  const [meetingAt, setMeetingAt] = useState('');
  const [meetingLink, setMeetingLink] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data: OrderDetail = await jsonOrThrow(await fetch(`/api/orders/${orderId}`));
      setDetail(data);

      if (data.service.slug) {
        const specs = getOnboardingFieldSpecs(data.service.slug);
        const initial: Record<string, string | string[]> = {};
        for (const spec of specs) {
          initial[spec.name] = fieldValueToFormValue(spec, data.onboarding?.data?.[spec.name]);
        }
        setFormValues(initial);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  function buildOnboardingPayload(slug: string): Record<string, unknown> {
    const specs = getOnboardingFieldSpecs(slug);
    const payload: Record<string, unknown> = {};
    for (const spec of specs) {
      const value = coerceFieldValue(spec, formValues[spec.name]);
      if (value !== undefined) payload[spec.name] = value;
    }
    return payload;
  }

  async function handleSaveDraft() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await jsonOrThrow(
        await fetch(`/api/orders/${orderId}/onboarding`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildOnboardingPayload(detail.service.slug)),
        })
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitOnboarding() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await jsonOrThrow(
        await fetch(`/api/orders/${orderId}/onboarding`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildOnboardingPayload(detail.service.slug)),
        })
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function handleScheduleMeeting(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await jsonOrThrow(
        await fetch(`/api/orders/${orderId}/meeting`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scheduledAt: new Date(meetingAt).toISOString(),
            meetingLink: meetingLink || undefined,
          }),
        })
      );
      setMeetingAt('');
      setMeetingLink('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function handleLockRequirements() {
    setBusy(true);
    setError(null);
    try {
      await jsonOrThrow(await fetch(`/api/orders/${orderId}/lock-requirements`, { method: 'POST' }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm('Cancel this order?')) return;
    setBusy(true);
    setError(null);
    try {
      await jsonOrThrow(await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (!detail) return <p className="text-red-700">{error ?? 'Order not found'}</p>;

  const { order, service, plan, meetings, isOwner, permissions } = detail;
  const isLocked = Boolean(order.requirementsLockedAt);
  const isTerminal = order.stage === 'CANCELLED' || order.stage === 'COMPLETED';
  const canEditOnboarding = isOwner && !isLocked && !isTerminal;
  const fieldSpecs = getOnboardingFieldSpecs(service.slug);

  return (
    <div className="space-y-8">
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="rounded-md border border-gray-200 p-4">
        <div className="text-sm text-gray-500">{service.name}</div>
        <div className="font-medium text-gray-900">{plan.name}</div>
        <div className="mt-2 text-sm text-gray-500">Stage</div>
        <div className="text-lg font-semibold text-gray-900">{STAGE_LABELS[order.stage] ?? order.stage}</div>
        <div className="mt-2 text-sm text-gray-500">Amount</div>
        <div className="text-gray-900">{formatPaise(order.amountPaise)}</div>
      </div>

      {order.stage === 'AWAITING_PAYMENT' && (
        <p className="text-amber-700">Payment for this order hasn&apos;t been completed yet.</p>
      )}

      {(order.stage === 'ONBOARDING' || order.stage === 'MEETING_SCHEDULED') && isOwner && (
        <div>
          <h2 className="font-medium text-gray-900">Onboarding brief</h2>
          {detail.onboarding?.submittedAt && !isLocked && (
            <p className="mt-1 text-sm text-gray-500">
              Submitted — you can still make changes until requirements are locked.
            </p>
          )}
          <div className="mt-4 space-y-4">
            {fieldSpecs.map((spec) => (
              <OnboardingField
                key={spec.name}
                spec={spec}
                value={formValues[spec.name] ?? (spec.kind === 'multiselect' ? [] : '')}
                disabled={!canEditOnboarding || busy}
                onChange={(value) => setFormValues((prev) => ({ ...prev, [spec.name]: value }))}
              />
            ))}
          </div>
          {canEditOnboarding && (
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={busy}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Save draft
              </button>
              <button
                type="button"
                onClick={handleSubmitOnboarding}
                disabled={busy}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Submit brief
              </button>
            </div>
          )}
        </div>
      )}

      {isLocked && detail.onboarding && (
        <div>
          <h2 className="font-medium text-gray-900">Onboarding brief (locked)</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {fieldSpecs.map((spec) => (
              <div key={spec.name} className="flex gap-2">
                <dt className="w-56 shrink-0 text-gray-500">{spec.label}</dt>
                <dd className="text-gray-900">
                  {Array.isArray(detail.onboarding?.data[spec.name])
                    ? (detail.onboarding?.data[spec.name] as string[]).join(', ')
                    : String(detail.onboarding?.data[spec.name] ?? '—')}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {meetings.length > 0 && (
        <div>
          <h2 className="font-medium text-gray-900">Meetings</h2>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {meetings.map((m) => (
              <li key={m.id}>
                {new Date(m.scheduledAt).toLocaleString()}
                {m.meetingLink && (
                  <>
                    {' — '}
                    <a href={m.meetingLink} className="text-brand hover:underline">
                      Join link
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {permissions.scheduleMeeting && order.stage === 'ONBOARDING' && (
        <form onSubmit={handleScheduleMeeting} className="rounded-md border border-gray-200 p-4">
          <h2 className="font-medium text-gray-900">Schedule a meeting (staff)</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Date &amp; time</label>
              <input
                type="datetime-local"
                required
                value={meetingAt}
                onChange={(e) => setMeetingAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Meeting link (optional)</label>
              <input
                type="url"
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Schedule
            </button>
          </div>
        </form>
      )}

      {permissions.updateStage && order.stage === 'MEETING_SCHEDULED' && (
        <div className="rounded-md border border-gray-200 p-4">
          <h2 className="font-medium text-gray-900">Requirements (staff)</h2>
          <p className="mt-1 text-sm text-gray-500">
            Locking requirements is one-way — there is no unlocking once the team starts work.
          </p>
          <button
            type="button"
            onClick={handleLockRequirements}
            disabled={busy}
            className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Lock requirements
          </button>
        </div>
      )}

      {permissions.cancel && !isTerminal && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          className="text-sm text-red-700 hover:underline disabled:opacity-50"
        >
          Cancel this order
        </button>
      )}
    </div>
  );
}

function OnboardingField({
  spec,
  value,
  disabled,
  onChange,
}: {
  spec: OnboardingFieldSpec;
  value: string | string[];
  disabled: boolean;
  onChange: (value: string | string[]) => void;
}) {
  if (spec.kind === 'textarea') {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700">{spec.label}</label>
        <textarea
          value={value as string}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100"
        />
      </div>
    );
  }

  if (spec.kind === 'select') {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700">{spec.label}</label>
        <select
          value={value as string}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100"
        >
          <option value="">Select…</option>
          {spec.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (spec.kind === 'multiselect') {
    const selected = value as string[];
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700">{spec.label}</label>
        <div className="mt-1 flex flex-wrap gap-3">
          {spec.options.map((opt) => (
            <label key={opt} className="flex items-center gap-1 text-sm text-gray-700">
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.includes(opt)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, opt] : selected.filter((o) => o !== opt))
                }
              />
              {opt.replace(/_/g, ' ')}
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{spec.label}</label>
      <input
        type={spec.kind === 'number' ? 'number' : spec.kind === 'url' ? 'url' : 'text'}
        value={value as string}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100"
      />
    </div>
  );
}
