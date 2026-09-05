import { asc, count, eq } from 'drizzle-orm';
import { db } from '@/db';
import { trainingCourses, trainingModules, trainingVideos } from '@/db/schema';

export class ParentNotPublishedError extends Error {
  constructor(what: 'module' | 'video', why: string) {
    super(`Cannot publish this ${what}: ${why}`);
    this.name = 'ParentNotPublishedError';
  }
}

export class NoSuchRowError extends Error {
  constructor(table: string, id: string) {
    super(`No such ${table}: ${id}`);
    this.name = 'NoSuchRowError';
  }
}

// --- Authoring (training.course.author) ---
// Everything here creates/edits in DRAFT (the table default) — nothing
// authored is ever visible to a learner until an explicit publish action
// below, which is a separate permission (training.course.publish).

export async function createCourse(params: {
  title: string;
  description?: string;
}): Promise<typeof trainingCourses.$inferSelect> {
  const [countRow] = await db.select({ value: count() }).from(trainingCourses);
  const existingCount = countRow?.value ?? 0;
  const [course] = await db
    .insert(trainingCourses)
    .values({ title: params.title, description: params.description, orderIndex: existingCount })
    .returning();
  if (!course) throw new Error('Insert did not return a row');
  return course;
}

export async function updateCourse(
  courseId: string,
  updates: { title?: string; description?: string | null; orderIndex?: number }
): Promise<typeof trainingCourses.$inferSelect> {
  const [updated] = await db
    .update(trainingCourses)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(trainingCourses.id, courseId))
    .returning();
  if (!updated) throw new NoSuchRowError('training course', courseId);
  return updated;
}

export async function createModule(params: { courseId: string; title: string }): Promise<typeof trainingModules.$inferSelect> {
  const [moduleCountRow] = await db
    .select({ value: count() })
    .from(trainingModules)
    .where(eq(trainingModules.courseId, params.courseId));
  const existingCount = moduleCountRow?.value ?? 0;
  const [module] = await db
    .insert(trainingModules)
    .values({ courseId: params.courseId, title: params.title, orderIndex: existingCount })
    .returning();
  if (!module) throw new Error('Insert did not return a row');
  return module;
}

export async function updateModule(
  moduleId: string,
  updates: { title?: string; orderIndex?: number }
): Promise<typeof trainingModules.$inferSelect> {
  const [updated] = await db.update(trainingModules).set(updates).where(eq(trainingModules.id, moduleId)).returning();
  if (!updated) throw new NoSuchRowError('training module', moduleId);
  return updated;
}

export async function createVideo(params: {
  moduleId: string;
  title: string;
  videoUrl: string;
  durationSeconds: number;
}): Promise<typeof trainingVideos.$inferSelect> {
  const [videoCountRow] = await db
    .select({ value: count() })
    .from(trainingVideos)
    .where(eq(trainingVideos.moduleId, params.moduleId));
  const existingCount = videoCountRow?.value ?? 0;
  const [video] = await db
    .insert(trainingVideos)
    .values({
      moduleId: params.moduleId,
      title: params.title,
      videoUrl: params.videoUrl,
      durationSeconds: params.durationSeconds,
      orderIndex: existingCount,
    })
    .returning();
  if (!video) throw new Error('Insert did not return a row');
  return video;
}

export async function updateVideo(
  videoId: string,
  updates: { title?: string; videoUrl?: string; durationSeconds?: number; orderIndex?: number }
): Promise<typeof trainingVideos.$inferSelect> {
  const [updated] = await db.update(trainingVideos).set(updates).where(eq(trainingVideos.id, videoId)).returning();
  if (!updated) throw new NoSuchRowError('training video', videoId);
  return updated;
}

// --- Publishing (training.course.publish — a separate permission from
// authoring on purpose, same reasoning as service.edit vs service.pricing,
// docs/ARCHITECTURE.md §11) ---
//
// "A lesson cannot be published before its parent module and course are"
// (docs/ARCHITECTURE.md §10) is enforced here at write time, IN ADDITION
// to (never instead of) src/lib/training/catalogue.ts's read-time
// full-chain filter — a course can be unpublished again after its modules
// were published, so a module/video's own status column publishing
// successfully once is not proof its ancestors are still published later;
// each publish call re-checks the CURRENT state of its parent(s), not
// whatever was true when the parent itself was last published.

export async function publishCourse(courseId: string): Promise<typeof trainingCourses.$inferSelect> {
  const [updated] = await db
    .update(trainingCourses)
    .set({ status: 'PUBLISHED', updatedAt: new Date() })
    .where(eq(trainingCourses.id, courseId))
    .returning();
  if (!updated) throw new NoSuchRowError('training course', courseId);
  return updated;
}

export async function unpublishCourse(courseId: string): Promise<typeof trainingCourses.$inferSelect> {
  const [updated] = await db
    .update(trainingCourses)
    .set({ status: 'DRAFT', updatedAt: new Date() })
    .where(eq(trainingCourses.id, courseId))
    .returning();
  if (!updated) throw new NoSuchRowError('training course', courseId);
  return updated;
}

export async function publishModule(moduleId: string): Promise<typeof trainingModules.$inferSelect> {
  const [row] = await db
    .select({ module: trainingModules, course: trainingCourses })
    .from(trainingModules)
    .innerJoin(trainingCourses, eq(trainingCourses.id, trainingModules.courseId))
    .where(eq(trainingModules.id, moduleId));
  if (!row) throw new NoSuchRowError('training module', moduleId);
  if (row.course.status !== 'PUBLISHED') {
    throw new ParentNotPublishedError('module', `its course ("${row.course.title}") is not published`);
  }

  const [updated] = await db
    .update(trainingModules)
    .set({ status: 'PUBLISHED' })
    .where(eq(trainingModules.id, moduleId))
    .returning();
  if (!updated) throw new Error('Update did not return a row');
  return updated;
}

export async function unpublishModule(moduleId: string): Promise<typeof trainingModules.$inferSelect> {
  const [updated] = await db
    .update(trainingModules)
    .set({ status: 'DRAFT' })
    .where(eq(trainingModules.id, moduleId))
    .returning();
  if (!updated) throw new NoSuchRowError('training module', moduleId);
  return updated;
}

export async function publishVideo(videoId: string): Promise<typeof trainingVideos.$inferSelect> {
  const [row] = await db
    .select({ video: trainingVideos, module: trainingModules, course: trainingCourses })
    .from(trainingVideos)
    .innerJoin(trainingModules, eq(trainingModules.id, trainingVideos.moduleId))
    .innerJoin(trainingCourses, eq(trainingCourses.id, trainingModules.courseId))
    .where(eq(trainingVideos.id, videoId));
  if (!row) throw new NoSuchRowError('training video', videoId);
  if (row.course.status !== 'PUBLISHED') {
    throw new ParentNotPublishedError('video', `its course ("${row.course.title}") is not published`);
  }
  if (row.module.status !== 'PUBLISHED') {
    throw new ParentNotPublishedError('video', `its module ("${row.module.title}") is not published`);
  }

  const [updated] = await db
    .update(trainingVideos)
    .set({ status: 'PUBLISHED' })
    .where(eq(trainingVideos.id, videoId))
    .returning();
  if (!updated) throw new Error('Update did not return a row');
  return updated;
}

export async function unpublishVideo(videoId: string): Promise<typeof trainingVideos.$inferSelect> {
  const [updated] = await db.update(trainingVideos).set({ status: 'DRAFT' }).where(eq(trainingVideos.id, videoId)).returning();
  if (!updated) throw new NoSuchRowError('training video', videoId);
  return updated;
}

// --- Admin reads (see everything, draft included) ---

export async function getCourseWithEverything(courseId: string): Promise<{
  course: typeof trainingCourses.$inferSelect;
  modules: { module: typeof trainingModules.$inferSelect; videos: (typeof trainingVideos.$inferSelect)[] }[];
} | null> {
  const [course] = await db.select().from(trainingCourses).where(eq(trainingCourses.id, courseId));
  if (!course) return null;

  const modules = await db
    .select()
    .from(trainingModules)
    .where(eq(trainingModules.courseId, courseId))
    .orderBy(asc(trainingModules.orderIndex));

  const result = [];
  for (const mod of modules) {
    const videos = await db
      .select()
      .from(trainingVideos)
      .where(eq(trainingVideos.moduleId, mod.id))
      .orderBy(asc(trainingVideos.orderIndex));
    result.push({ module: mod, videos });
  }
  return { course, modules: result };
}

export async function getAllCourses(): Promise<(typeof trainingCourses.$inferSelect)[]> {
  return db.select().from(trainingCourses).orderBy(asc(trainingCourses.orderIndex));
}
