'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginSchema } from '@/lib/auth/schemas';
import { safeInternalPath } from '@/lib/safe-redirect';

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Password step succeeded but the account has MFA enabled — the session
  // cookie is already set (src/app/api/auth/login/route.ts creates it
  // either way), it just isn't usable for anything yet
  // (src/lib/auth/actor.ts refuses an unverified session outright), so
  // this renders a second form instead of redirecting.
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);
    const values = { email: formData.get('email'), password: formData.get('password') };
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === 'string' ? body.error : 'Invalid email or password');
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.mfaRequired) {
        setMfaRequired(true);
        return;
      }
      router.push(safeInternalPath(next, '/account'));
      router.refresh();
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: mfaCode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === 'string' ? body.error : 'Invalid code');
        return;
      }
      router.push(safeInternalPath(next, '/account'));
      router.refresh();
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (mfaRequired) {
    return (
      <form onSubmit={handleMfaSubmit} className="mt-8 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Authentication code</label>
          <p className="mt-1 text-sm text-gray-500">
            Enter the 6-digit code from your authenticator app, or one of your recovery codes.
          </p>
          <input
            name="code"
            type="text"
            inputMode="numeric"
            autoFocus
            required
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-brand px-6 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Verifying…' : 'Verify'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">Email</label>
        <input name="email" type="email" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Password</label>
        <input name="password" type="password" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-brand px-6 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
