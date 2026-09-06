'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type SetupState = { secret: string; otpauthUrl: string } | null;

// Self-service TOTP enrollment/disablement, rendered on /account for any
// signed-in user — this build treats MFA as opt-in per account, matching
// users.mfaEnabled's per-user (not per-role) design; a mandatory
// admin-role policy is a separate business decision this codebase doesn't
// assume (docs/ARCHITECTURE.md §29).
export function MfaSettings({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [setup, setSetup] = useState<SetupState>(null);
  const [enableCode, setEnableCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const [showDisableForm, setShowDisableForm] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  async function startSetup() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/mfa/setup', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Could not start MFA setup');
        return;
      }
      setSetup({ secret: body.secret, otpauthUrl: body.otpauthUrl });
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmEnable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/mfa/enable', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: enableCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Invalid code');
        return;
      }
      setRecoveryCodes(body.recoveryCodes);
      setEnabled(true);
      setSetup(null);
      setEnableCode('');
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDisable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: disablePassword, code: disableCode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Could not disable MFA');
        return;
      }
      setEnabled(false);
      setShowDisableForm(false);
      setDisablePassword('');
      setDisableCode('');
      router.refresh();
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // Recovery codes are shown exactly once, right after enabling — closing
  // this out is a deliberate acknowledgement, not just a status refresh.
  if (recoveryCodes) {
    return (
      <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4">
        <h3 className="font-medium text-gray-900">Save your recovery codes</h3>
        <p className="mt-1 text-sm text-gray-600">
          Each code can be used once if you lose access to your authenticator app. They will not be shown again.
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-1 font-mono text-sm text-gray-900">
          {recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            setRecoveryCodes(null);
            router.refresh();
          }}
          className="mt-4 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          I&rsquo;ve saved these
        </button>
      </div>
    );
  }

  if (setup) {
    return (
      <form onSubmit={confirmEnable} className="mt-6 space-y-3 rounded-md border border-gray-200 p-4">
        <p className="text-sm text-gray-600">
          Scan this into your authenticator app, or enter the code manually, then confirm with a code below.
        </p>
        <p className="break-all rounded bg-gray-50 p-2 font-mono text-xs text-gray-800">{setup.otpauthUrl}</p>
        <div>
          <label className="block text-sm font-medium text-gray-700">Manual entry key</label>
          <p className="mt-1 break-all font-mono text-sm text-gray-900">{setup.secret}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Enter the 6-digit code to confirm</label>
          <input
            type="text"
            inputMode="numeric"
            required
            value={enableCode}
            onChange={(e) => setEnableCode(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Confirming…' : 'Confirm and enable'}
        </button>
      </form>
    );
  }

  if (enabled) {
    return (
      <div className="mt-4">
        {!showDisableForm ? (
          <button
            type="button"
            onClick={() => setShowDisableForm(true)}
            className="text-sm text-red-600 hover:underline"
          >
            Disable two-factor authentication
          </button>
        ) : (
          <form onSubmit={confirmDisable} className="mt-3 space-y-3 rounded-md border border-gray-200 p-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Current password</label>
              <input
                type="password"
                required
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Authentication or recovery code</label>
              <input
                type="text"
                required
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Disabling…' : 'Confirm disable'}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={startSetup}
        disabled={submitting}
        className="text-sm text-brand hover:underline disabled:opacity-50"
      >
        Enable two-factor authentication
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
