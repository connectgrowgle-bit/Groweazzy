'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Course = { id: string; title: string; description: string | null; status: string };

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.formErrors?.[0] ?? body.error ?? `Request failed (${res.status})`);
  return body;
}

export function TrainingAdminCourseList() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');

  async function load() {
    setError(null);
    try {
      const res = await fetch('/api/training/admin/courses');
      if (res.status === 403) {
        setError("You don't have permission to author training content.");
        return;
      }
      const body = await jsonOrThrow(res);
      setCourses(body.courses);
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
        await fetch('/api/training/admin/courses', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        })
      );
      setTitle('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (error && !courses) return <p className="text-red-700">{error}</p>;
  if (!courses) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="space-y-6">
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <ul className="space-y-2">
        {courses.map((c) => (
          <li key={c.id}>
            <Link
              href={`/training/admin/${c.id}`}
              className="flex items-center justify-between rounded-md border border-gray-200 p-3 text-sm hover:border-brand"
            >
              <span className="font-medium text-gray-900">{c.title}</span>
              <span className={c.status === 'PUBLISHED' ? 'text-green-700' : 'text-gray-400'}>{c.status}</span>
            </Link>
          </li>
        ))}
        {courses.length === 0 && <li className="text-gray-500">No courses yet.</li>}
      </ul>

      <form onSubmit={handleCreate} className="flex gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New course title"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Create
        </button>
      </form>
    </div>
  );
}
