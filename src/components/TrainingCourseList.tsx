'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Course = { id: string; title: string; description: string | null };

export function TrainingCourseList() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/training/courses');
        if (res.status === 403) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "You don't have access to training.");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        setCourses(body.courses);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    }
    load();
  }, []);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!courses) return <p className="text-gray-500">Loading…</p>;
  if (courses.length === 0) return <p className="text-gray-500">No courses published yet.</p>;

  return (
    <ul className="space-y-3">
      {courses.map((course) => (
        <li key={course.id}>
          <Link
            href={`/training/${course.id}`}
            className="block rounded-md border border-gray-200 p-4 hover:border-brand"
          >
            <div className="font-medium text-gray-900">{course.title}</div>
            {course.description && <div className="mt-1 text-sm text-gray-500">{course.description}</div>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
