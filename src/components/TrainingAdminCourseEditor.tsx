'use client';

import { useEffect, useState } from 'react';

type Video = { id: string; title: string; videoUrl: string; durationSeconds: number; status: string };
type Module = { id: string; title: string; status: string };
type Detail = {
  course: { id: string; title: string; description: string | null; status: string };
  modules: { module: Module; videos: Video[] }[];
};

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.formErrors?.[0] ?? body.error ?? `Request failed (${res.status})`);
  return body;
}

export function TrainingAdminCourseEditor({ courseId }: { courseId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [videoForm, setVideoForm] = useState<Record<string, { title: string; videoUrl: string; durationSeconds: string }>>(
    {}
  );

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/training/admin/courses/${courseId}`);
      if (res.status === 403) {
        setError("You don't have permission to author training content.");
        return;
      }
      if (res.status === 404) {
        setError('Course not found.');
        return;
      }
      setDetail(await jsonOrThrow(res));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  function updateVideoForm(moduleId: string, field: 'title' | 'videoUrl' | 'durationSeconds', value: string) {
    setVideoForm((prev) => ({
      ...prev,
      [moduleId]: { title: '', videoUrl: '', durationSeconds: '', ...prev[moduleId], [field]: value },
    }));
  }

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

  const { course, modules } = detail;

  return (
    <div className="space-y-8">
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{course.title}</h1>
          <span className={course.status === 'PUBLISHED' ? 'text-sm text-green-700' : 'text-sm text-gray-400'}>
            {course.status}
          </span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            withBusy(async () => {
              const action = course.status === 'PUBLISHED' ? 'unpublish' : 'publish';
              await jsonOrThrow(await fetch(`/api/training/admin/courses/${courseId}/${action}`, { method: 'POST' }));
            })
          }
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {course.status === 'PUBLISHED' ? 'Unpublish course' : 'Publish course'}
        </button>
      </div>

      <div className="space-y-6">
        {modules.map(({ module, videos }) => (
          <div key={module.id} className="rounded-md border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-gray-900">{module.title}</span>{' '}
                <span className={module.status === 'PUBLISHED' ? 'text-xs text-green-700' : 'text-xs text-gray-400'}>
                  {module.status}
                </span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  withBusy(async () => {
                    const action = module.status === 'PUBLISHED' ? 'unpublish' : 'publish';
                    await jsonOrThrow(await fetch(`/api/training/admin/modules/${module.id}/${action}`, { method: 'POST' }));
                  })
                }
                className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
              >
                {module.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
              </button>
            </div>

            <ul className="mt-3 space-y-2">
              {videos.map((video) => (
                <li key={video.id} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-sm">
                  <span>
                    {video.title}{' '}
                    <span className="text-xs text-gray-400">({video.durationSeconds}s)</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={video.status === 'PUBLISHED' ? 'text-xs text-green-700' : 'text-xs text-gray-400'}>
                      {video.status}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        withBusy(async () => {
                          const action = video.status === 'PUBLISHED' ? 'unpublish' : 'publish';
                          await jsonOrThrow(
                            await fetch(`/api/training/admin/videos/${video.id}/${action}`, { method: 'POST' })
                          );
                        })
                      }
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-white disabled:opacity-50"
                    >
                      {video.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                    </button>
                  </div>
                </li>
              ))}
              {videos.length === 0 && <li className="text-sm text-gray-500">No videos yet.</li>}
            </ul>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = videoForm[module.id] ?? { title: '', videoUrl: '', durationSeconds: '' };
                withBusy(async () => {
                  await jsonOrThrow(
                    await fetch('/api/training/admin/videos', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        moduleId: module.id,
                        title: form.title,
                        videoUrl: form.videoUrl,
                        durationSeconds: Number(form.durationSeconds),
                      }),
                    })
                  );
                  setVideoForm((prev) => ({ ...prev, [module.id]: { title: '', videoUrl: '', durationSeconds: '' } }));
                });
              }}
              className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4"
            >
              <input
                value={videoForm[module.id]?.title ?? ''}
                onChange={(e) => updateVideoForm(module.id, 'title', e.target.value)}
                placeholder="Video title"
                className="rounded-md border border-gray-300 px-2 py-1 text-sm sm:col-span-2"
              />
              <input
                value={videoForm[module.id]?.videoUrl ?? ''}
                onChange={(e) => updateVideoForm(module.id, 'videoUrl', e.target.value)}
                placeholder="Video URL"
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
              <input
                value={videoForm[module.id]?.durationSeconds ?? ''}
                onChange={(e) => updateVideoForm(module.id, 'durationSeconds', e.target.value)}
                placeholder="Duration (s)"
                type="number"
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
              <button
                type="submit"
                disabled={busy}
                className="col-span-full rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50 sm:col-span-1"
              >
                Add video
              </button>
            </form>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          withBusy(async () => {
            await jsonOrThrow(
              await fetch('/api/training/admin/modules', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ courseId, title: newModuleTitle }),
              })
            );
            setNewModuleTitle('');
          });
        }}
        className="flex gap-3"
      >
        <input
          value={newModuleTitle}
          onChange={(e) => setNewModuleTitle(e.target.value)}
          placeholder="New module title"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !newModuleTitle.trim()}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Add module
        </button>
      </form>
    </div>
  );
}
