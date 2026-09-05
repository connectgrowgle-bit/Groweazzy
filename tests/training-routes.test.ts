import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { roles, trainingCourses, userRoles, users } from '@/db/schema';
import { seedRolesAndPermissions } from '@/lib/auth/seed-rbac';
import { TEST_SERVER_URL } from './global-setup';
import { createTestAffiliate, deleteTestUser } from './helpers';

const BASE_URL = TEST_SERVER_URL;
const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];

function extractCookieHeader(res: Response): string {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

async function registerAndGetCookie(label: string): Promise<{ cookie: string; email: string; userId: string }> {
  const email = `${label}-${randomUUID()}@example.test`;
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: label, email, password: 'a-strong-enough-password' }),
  });
  if (res.status !== 201) throw new Error(`Failed to register ${label}: ${res.status}`);
  const [userRow] = await db.select().from(users).where(eq(users.email, email));
  if (!userRow) throw new Error('User row not found after registration');
  createdUserIds.push(userRow.id);
  return { cookie: extractCookieHeader(res), email, userId: userRow.id };
}

async function grantRole(userId: string, roleKey: string) {
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey));
  if (!role) throw new Error(`Role ${roleKey} not seeded`);
  await db.insert(userRoles).values({ userId, roleId: role.id });
}

beforeAll(async () => {
  await seedRolesAndPermissions();
});

afterAll(async () => {
  while (createdCourseIds.length) {
    const id = createdCourseIds.pop();
    if (id) await db.delete(trainingCourses).where(eq(trainingCourses.id, id));
  }
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('training API routes (real server, real Postgres)', () => {
  it('full flow: content manager authors + publishes, an ACTIVE affiliate learns, staff sees the report', async () => {
    const author = await registerAndGetCookie('trainingauthor');
    await grantRole(author.userId, 'CONTENT_MANAGER');
    const { user: affiliateUser, cookie: learnerCookie } = await (async () => {
      const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
      createdUserIds.push(user.id);
      // Log the affiliate fixture in for real, over HTTP, rather than
      // forging a cookie — createTestAffiliate bypasses registration but
      // sets a real password via createTestUser underneath it.
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: 'a-reasonably-strong-test-password' }),
      });
      expect(loginRes.status).toBe(200);
      return { user, affiliate, cookie: extractCookieHeader(loginRes) };
    })();

    // Author a course.
    const courseRes = await fetch(`${BASE_URL}/api/training/admin/courses`, {
      method: 'POST',
      headers: { cookie: author.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Affiliate Basics' }),
    });
    expect(courseRes.status).toBe(201);
    const course = await courseRes.json();
    createdCourseIds.push(course.id);

    const moduleRes = await fetch(`${BASE_URL}/api/training/admin/modules`, {
      method: 'POST',
      headers: { cookie: author.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ courseId: course.id, title: 'Getting Started' }),
    });
    const mod = await moduleRes.json();

    const videoRes = await fetch(`${BASE_URL}/api/training/admin/videos`, {
      method: 'POST',
      headers: { cookie: author.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        moduleId: mod.id,
        title: 'Welcome',
        videoUrl: 'https://example.test/welcome.mp4',
        durationSeconds: 60,
      }),
    });
    const video = await videoRes.json();

    // Not visible to the learner yet — nothing published.
    const beforePublish = await (
      await fetch(`${BASE_URL}/api/training/courses`, { headers: { cookie: learnerCookie } })
    ).json();
    expect(beforePublish.courses.some((c: { id: string }) => c.id === course.id)).toBe(false);

    // Publish the whole chain.
    await fetch(`${BASE_URL}/api/training/admin/courses/${course.id}/publish`, {
      method: 'POST',
      headers: { cookie: author.cookie },
    });
    await fetch(`${BASE_URL}/api/training/admin/modules/${mod.id}/publish`, {
      method: 'POST',
      headers: { cookie: author.cookie },
    });
    await fetch(`${BASE_URL}/api/training/admin/videos/${video.id}/publish`, {
      method: 'POST',
      headers: { cookie: author.cookie },
    });

    const afterPublish = await (
      await fetch(`${BASE_URL}/api/training/courses`, { headers: { cookie: learnerCookie } })
    ).json();
    expect(afterPublish.courses.some((c: { id: string }) => c.id === course.id)).toBe(true);

    const detailRes = await fetch(`${BASE_URL}/api/training/courses/${course.id}`, {
      headers: { cookie: learnerCookie },
    });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.modules[0].videos[0].video.id).toBe(video.id);
    expect(detail.modules[0].videos[0].progress).toBeNull();

    // Learner watches most of it.
    const progressRes = await fetch(`${BASE_URL}/api/training/progress`, {
      method: 'POST',
      headers: { cookie: learnerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ videoId: video.id, secondsWatched: 55 }),
    });
    expect(progressRes.status).toBe(200);
    const progress = await progressRes.json();
    expect(progress.completedAt).not.toBeNull(); // 55/60 = 91.6% >= 90%

    // training.progress.view_all is a SEPARATE permission from
    // training.course.author/publish (docs/ARCHITECTURE.md rule 4's
    // permission-catalogue split) — CONTENT_MANAGER (what `author` holds)
    // does not carry it, only ADMIN does by default.
    const authorReportRes = await fetch(`${BASE_URL}/api/training/admin/progress?videoId=${video.id}`, {
      headers: { cookie: author.cookie },
    });
    expect(authorReportRes.status).toBe(403);

    const reporter = await registerAndGetCookie('trainingreporter');
    await grantRole(reporter.userId, 'ADMIN');
    const reportRes = await fetch(`${BASE_URL}/api/training/admin/progress?videoId=${video.id}`, {
      headers: { cookie: reporter.cookie },
    });
    expect(reportRes.status).toBe(200);
    const report = await reportRes.json();
    expect(report.summary.totalStarted).toBe(1);
    expect(report.summary.totalCompleted).toBe(1);
    expect(report.rows[0].email).toBe(affiliateUser.email);
  });

  it('a plain (non-affiliate) customer cannot list or view training courses', async () => {
    const customer = await registerAndGetCookie('plaincustomer');
    const res = await fetch(`${BASE_URL}/api/training/courses`, { headers: { cookie: customer.cookie } });
    expect(res.status).toBe(403);
  });

  it('a user without training.course.author cannot create a course', async () => {
    const plain = await registerAndGetCookie('notanauthor');
    const res = await fetch(`${BASE_URL}/api/training/admin/courses`, {
      method: 'POST',
      headers: { cookie: plain.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Should not be created' }),
    });
    expect(res.status).toBe(403);
  });

  it('publishing a module before its course is published returns 409', async () => {
    const author = await registerAndGetCookie('trainingauthor2');
    await grantRole(author.userId, 'CONTENT_MANAGER');

    const courseRes = await fetch(`${BASE_URL}/api/training/admin/courses`, {
      method: 'POST',
      headers: { cookie: author.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Unpublished Course' }),
    });
    const course = await courseRes.json();
    createdCourseIds.push(course.id);

    const moduleRes = await fetch(`${BASE_URL}/api/training/admin/modules`, {
      method: 'POST',
      headers: { cookie: author.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ courseId: course.id, title: 'Module' }),
    });
    const mod = await moduleRes.json();

    const publishModuleRes = await fetch(`${BASE_URL}/api/training/admin/modules/${mod.id}/publish`, {
      method: 'POST',
      headers: { cookie: author.cookie },
    });
    expect(publishModuleRes.status).toBe(409);
  });
});
