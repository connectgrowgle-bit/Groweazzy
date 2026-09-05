'use client';

import { useEffect, useRef, useState } from 'react';

type VideoRow = {
  video: { id: string; title: string; videoUrl: string; durationSeconds: number };
  progress: { secondsWatched: number; completedAt: string | null } | null;
};
type ModuleRow = { module: { id: string; title: string }; videos: VideoRow[] };
type Detail = { course: { id: string; title: string; description: string | null }; modules: ModuleRow[] };

const REPORT_INTERVAL_SECONDS = 5;

export function TrainingCourseDetail({ courseId }: { courseId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const lastReportedRef = useRef(0);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/training/courses/${courseId}`);
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "You don't have access to training.");
        return;
      }
      if (res.status === 404) {
        setError('Course not found.');
        return;
      }
      const body: Detail = await res.json();
      setDetail(body);
      if (!activeVideoId) {
        const firstVideo = body.modules[0]?.videos[0]?.video.id;
        if (firstVideo) setActiveVideoId(firstVideo);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  async function reportProgress(videoId: string, secondsWatched: number) {
    try {
      await fetch('/api/training/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId, secondsWatched }),
      });
    } catch {
      // Best-effort — a dropped progress ping isn't worth surfacing to the
      // learner mid-video; the next timeupdate tick tries again.
    }
  }

  function handleTimeUpdate(videoId: string, e: React.SyntheticEvent<HTMLVideoElement>) {
    const current = e.currentTarget.currentTime;
    if (current - lastReportedRef.current >= REPORT_INTERVAL_SECONDS) {
      lastReportedRef.current = current;
      reportProgress(videoId, current);
    }
  }

  function handlePauseOrEnded(videoId: string, e: React.SyntheticEvent<HTMLVideoElement>) {
    lastReportedRef.current = e.currentTarget.currentTime;
    reportProgress(videoId, e.currentTarget.currentTime).then(load);
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!detail) return <p className="text-gray-500">Loading…</p>;

  const activeRow = detail.modules.flatMap((m) => m.videos).find((v) => v.video.id === activeVideoId);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">{detail.course.title}</h1>
      {detail.course.description && <p className="mt-1 text-gray-500">{detail.course.description}</p>}

      {activeRow && (
        <div className="mt-6">
          <video
            key={activeRow.video.id}
            src={activeRow.video.videoUrl}
            controls
            className="w-full rounded-md bg-black"
            onTimeUpdate={(e) => handleTimeUpdate(activeRow.video.id, e)}
            onPause={(e) => handlePauseOrEnded(activeRow.video.id, e)}
            onEnded={(e) => handlePauseOrEnded(activeRow.video.id, e)}
          />
          <div className="mt-2 font-medium text-gray-900">{activeRow.video.title}</div>
        </div>
      )}

      <div className="mt-8 space-y-6">
        {detail.modules.map(({ module, videos }) => (
          <div key={module.id}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{module.title}</h2>
            <ul className="mt-2 space-y-1">
              {videos.map(({ video, progress }) => (
                <li key={video.id}>
                  <button
                    type="button"
                    onClick={() => {
                      lastReportedRef.current = 0;
                      setActiveVideoId(video.id);
                    }}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                      video.id === activeVideoId ? 'bg-gray-50 font-medium text-gray-900' : 'text-gray-700'
                    }`}
                  >
                    <span>{video.title}</span>
                    <span className="text-xs text-gray-400">
                      {progress?.completedAt
                        ? '✓ Completed'
                        : progress
                          ? `${Math.round((progress.secondsWatched / video.durationSeconds) * 100)}%`
                          : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
