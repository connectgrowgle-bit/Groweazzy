import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { roles, trainingCourses, trainingModules, userRoles } from '@/db/schema';
import {
  createCourse,
  createModule,
  createVideo,
  NoSuchRowError,
  ParentNotPublishedError,
  publishCourse,
  publishModule,
  publishVideo,
  unpublishCourse,
  unpublishModule,
} from '@/lib/training/authoring';
import {
  getPublishedCourseDetail,
  getPublishedCourses,
  getPublishedVideoWithContext,
} from '@/lib/training/catalogue';
import { recordProgress, VideoNotAccessibleError } from '@/lib/training/progress';
import { canAccessTraining } from '@/lib/training/access';
import { seedRolesAndPermissions } from '@/lib/auth/seed-rbac';
import { createTestAffiliate, createTestUser, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];

async function grantRole(userId: string, roleKey: string) {
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey));
  if (!role) throw new Error(`Role ${roleKey} not seeded`);
  await db.insert(userRoles).values({ userId, roleId: role.id });
}

async function makeCourse() {
  const course = await createCourse({ title: `Test Course ${Date.now()}-${Math.random()}` });
  createdCourseIds.push(course.id);
  return course;
}

afterEach(async () => {
  while (createdCourseIds.length) {
    const id = createdCourseIds.pop();
    // trainingModules/trainingVideos both cascade off courseId/moduleId — a
    // plain course delete is enough.
    if (id) await db.delete(trainingCourses).where(eq(trainingCourses.id, id));
  }
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('training authoring + publish guards (src/lib/training/authoring.ts)', () => {
  it('creates a course/module/video, all DRAFT by default', async () => {
    const course = await makeCourse();
    expect(course.status).toBe('DRAFT');

    const mod = await createModule({ courseId: course.id, title: 'Module 1' });
    expect(mod.status).toBe('DRAFT');

    const video = await createVideo({
      moduleId: mod.id,
      title: 'Video 1',
      videoUrl: 'https://example.test/video1.mp4',
      durationSeconds: 300,
    });
    expect(video.status).toBe('DRAFT');
  });

  it('refuses to publish a module before its course is published', async () => {
    const course = await makeCourse();
    const mod = await createModule({ courseId: course.id, title: 'Module 1' });

    await expect(publishModule(mod.id)).rejects.toThrow(ParentNotPublishedError);

    const [row] = await db.select().from(trainingModules).where(eq(trainingModules.id, mod.id));
    expect(row?.status).toBe('DRAFT');
  });

  it('refuses to publish a video before its module is published, even if the course is', async () => {
    const course = await makeCourse();
    await publishCourse(course.id);
    const mod = await createModule({ courseId: course.id, title: 'Module 1' });
    const video = await createVideo({
      moduleId: mod.id,
      title: 'Video 1',
      videoUrl: 'https://example.test/video1.mp4',
      durationSeconds: 300,
    });

    await expect(publishVideo(video.id)).rejects.toThrow(ParentNotPublishedError);
  });

  it('publishing the full chain in order succeeds', async () => {
    const course = await makeCourse();
    const mod = await createModule({ courseId: course.id, title: 'Module 1' });
    const video = await createVideo({
      moduleId: mod.id,
      title: 'Video 1',
      videoUrl: 'https://example.test/video1.mp4',
      durationSeconds: 300,
    });

    await publishCourse(course.id);
    await publishModule(mod.id);
    const publishedVideo = await publishVideo(video.id);
    expect(publishedVideo.status).toBe('PUBLISHED');
  });

  it("a module published while its course was published can no longer be published if the course is later unpublished and republishing is attempted on a video under it", async () => {
    const course = await makeCourse();
    const mod = await createModule({ courseId: course.id, title: 'Module 1' });
    await publishCourse(course.id);
    await publishModule(mod.id);

    // Course goes back to DRAFT — the module's own status column still
    // says PUBLISHED, but a NEW video under it must not be publishable,
    // since publishVideo re-checks the course's CURRENT status, not
    // whatever was true when the module was published.
    await unpublishCourse(course.id);
    const video = await createVideo({
      moduleId: mod.id,
      title: 'Video 1',
      videoUrl: 'https://example.test/video1.mp4',
      durationSeconds: 300,
    });

    await expect(publishVideo(video.id)).rejects.toThrow(ParentNotPublishedError);
  });

  it('unpublishing a module does not touch the course, and vice versa', async () => {
    const course = await makeCourse();
    const mod = await createModule({ courseId: course.id, title: 'Module 1' });
    await publishCourse(course.id);
    await publishModule(mod.id);

    await unpublishModule(mod.id);
    const [courseRow] = await db.select().from(trainingCourses).where(eq(trainingCourses.id, course.id));
    expect(courseRow?.status).toBe('PUBLISHED');
  });

  it('throws NoSuchRowError for a non-existent id', async () => {
    await expect(publishCourse('00000000-0000-0000-0000-000000000000')).rejects.toThrow(NoSuchRowError);
  });
});

describe('published-only reads (src/lib/training/catalogue.ts)', () => {
  it('getPublishedCourses excludes DRAFT courses', async () => {
    const draftCourse = await makeCourse();
    const publishedCourse = await makeCourse();
    await publishCourse(publishedCourse.id);

    const courses = await getPublishedCourses();
    const ids = courses.map((c) => c.id);
    expect(ids).toContain(publishedCourse.id);
    expect(ids).not.toContain(draftCourse.id);
  });

  it('getPublishedCourseDetail hides a DRAFT module/video inside an otherwise-published course', async () => {
    const course = await makeCourse();
    await publishCourse(course.id);

    const publishedModule = await createModule({ courseId: course.id, title: 'Published Module' });
    await publishModule(publishedModule.id);
    const publishedVideo = await createVideo({
      moduleId: publishedModule.id,
      title: 'Published Video',
      videoUrl: 'https://example.test/pub.mp4',
      durationSeconds: 100,
    });
    await publishVideo(publishedVideo.id);

    const draftModule = await createModule({ courseId: course.id, title: 'Draft Module' });
    await createVideo({
      moduleId: publishedModule.id,
      title: 'Draft Video Under Published Module',
      videoUrl: 'https://example.test/draft.mp4',
      durationSeconds: 100,
    });

    const detail = await getPublishedCourseDetail(course.id);
    expect(detail).not.toBeNull();
    const moduleIds = detail!.modules.map((m) => m.module.id);
    expect(moduleIds).toContain(publishedModule.id);
    expect(moduleIds).not.toContain(draftModule.id);

    const videoTitlesUnderPublishedModule = detail!.modules
      .find((m) => m.module.id === publishedModule.id)!
      .videos.map((v) => v.title);
    expect(videoTitlesUnderPublishedModule).toEqual(['Published Video']);
  });

  it('getPublishedVideoWithContext returns null if the video is PUBLISHED but its course is not', async () => {
    const course = await makeCourse();
    await publishCourse(course.id);
    const mod = await createModule({ courseId: course.id, title: 'Module 1' });
    await publishModule(mod.id);
    const video = await createVideo({
      moduleId: mod.id,
      title: 'Video 1',
      videoUrl: 'https://example.test/video1.mp4',
      durationSeconds: 300,
    });
    await publishVideo(video.id);

    // The video's own row still says PUBLISHED — only its ancestor changed.
    await unpublishCourse(course.id);

    const found = await getPublishedVideoWithContext(video.id);
    expect(found).toBeNull();
  });
});

describe('recordProgress (src/lib/training/progress.ts)', () => {
  async function makePublishedVideo(durationSeconds: number) {
    const course = await makeCourse();
    const mod = await createModule({ courseId: course.id, title: 'Module 1' });
    const video = await createVideo({
      moduleId: mod.id,
      title: 'Video 1',
      videoUrl: 'https://example.test/video1.mp4',
      durationSeconds,
    });
    await publishCourse(course.id);
    await publishModule(mod.id);
    await publishVideo(video.id);
    return video;
  }

  it('clamps reported seconds to the video duration', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const video = await makePublishedVideo(100);

    const row = await recordProgress(user.id, video.id, 9999);
    expect(row.secondsWatched).toBe(100);
  });

  it('is monotonic — a later, smaller report does not regress secondsWatched', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const video = await makePublishedVideo(100);

    await recordProgress(user.id, video.id, 80);
    const row = await recordProgress(user.id, video.id, 20);
    expect(row.secondsWatched).toBe(80);
  });

  it('completes at 90% watched, not 100%, and stays completed once crossed', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const video = await makePublishedVideo(100);

    const before = await recordProgress(user.id, video.id, 85);
    expect(before.completedAt).toBeNull();

    const at90 = await recordProgress(user.id, video.id, 90);
    expect(at90.completedAt).not.toBeNull();
    const firstCompletedAt = at90.completedAt;

    // A later, smaller report (e.g. a rewatch from the start) must not
    // clear or move completedAt.
    const later = await recordProgress(user.id, video.id, 5);
    expect(later.completedAt?.getTime()).toBe(firstCompletedAt?.getTime());
    expect(later.secondsWatched).toBe(90); // still monotonic
  });

  it('throws VideoNotAccessibleError for an unpublished or non-existent video', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const course = await makeCourse();
    const mod = await createModule({ courseId: course.id, title: 'Module 1' });
    const draftVideo = await createVideo({
      moduleId: mod.id,
      title: 'Draft Video',
      videoUrl: 'https://example.test/draft.mp4',
      durationSeconds: 100,
    });

    await expect(recordProgress(user.id, draftVideo.id, 10)).rejects.toThrow(VideoNotAccessibleError);
    await expect(recordProgress(user.id, '00000000-0000-0000-0000-000000000000', 10)).rejects.toThrow(
      VideoNotAccessibleError
    );
  });
});

describe('canAccessTraining (src/lib/training/access.ts)', () => {
  it('a plain customer cannot access training', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    expect(await canAccessTraining(user.id)).toBe(false);
  });

  it('an ACTIVE affiliate can access training', async () => {
    const { user } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    expect(await canAccessTraining(user.id)).toBe(true);
  });

  it('a non-ACTIVE affiliate (e.g. KYC_PENDING) cannot access training', async () => {
    const { user } = await createTestAffiliate({ status: 'KYC_PENDING' });
    createdUserIds.push(user.id);
    expect(await canAccessTraining(user.id)).toBe(false);
  });

  it('a staff member with training.course.author can access training without being an affiliate', async () => {
    await seedRolesAndPermissions();
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    await grantRole(user.id, 'CONTENT_MANAGER');
    expect(await canAccessTraining(user.id)).toBe(true);
  });
});
