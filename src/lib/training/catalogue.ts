import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { trainingCourses, trainingModules, trainingVideos } from '@/db/schema';

// "Draft content is absent from every query a learner's screen can see, not
// merely hidden by a UI flag" (docs/ARCHITECTURE.md §10). Every function
// here filters status = 'PUBLISHED' at the query itself — never fetches
// everything and lets a component decide what to render — and starting
// from an already-PUBLISHED parent before descending is what makes the
// nesting below sufficient: a module fetched under a published course is
// only ever fetched WHERE status = 'PUBLISHED' itself, so there is no path
// through these functions that can return a draft row to a learner.

export async function getPublishedCourses(): Promise<(typeof trainingCourses.$inferSelect)[]> {
  return db
    .select()
    .from(trainingCourses)
    .where(eq(trainingCourses.status, 'PUBLISHED'))
    .orderBy(asc(trainingCourses.orderIndex));
}

export type PublishedCourseDetail = {
  course: typeof trainingCourses.$inferSelect;
  modules: { module: typeof trainingModules.$inferSelect; videos: (typeof trainingVideos.$inferSelect)[] }[];
};

export async function getPublishedCourseDetail(courseId: string): Promise<PublishedCourseDetail | null> {
  const [course] = await db
    .select()
    .from(trainingCourses)
    .where(and(eq(trainingCourses.id, courseId), eq(trainingCourses.status, 'PUBLISHED')));
  if (!course) return null;

  const modules = await db
    .select()
    .from(trainingModules)
    .where(and(eq(trainingModules.courseId, courseId), eq(trainingModules.status, 'PUBLISHED')))
    .orderBy(asc(trainingModules.orderIndex));

  const result = [];
  for (const mod of modules) {
    const videos = await db
      .select()
      .from(trainingVideos)
      .where(and(eq(trainingVideos.moduleId, mod.id), eq(trainingVideos.status, 'PUBLISHED')))
      .orderBy(asc(trainingVideos.orderIndex));
    result.push({ module: mod, videos });
  }

  return { course, modules: result };
}

// The one place a single video is fetched by id for a learner — a video
// player page links here directly, so this independently re-verifies the
// FULL ancestor chain (video AND its module AND its course all
// PUBLISHED) in one query, rather than trusting that whatever linked here
// only ever links to published content. This is what makes an
// unpublished-course's video unreachable even if someone has the video id
// and its own status column still happens to say PUBLISHED.
export async function getPublishedVideoWithContext(
  videoId: string
): Promise<{ video: typeof trainingVideos.$inferSelect; module: typeof trainingModules.$inferSelect; course: typeof trainingCourses.$inferSelect } | null> {
  const [row] = await db
    .select({ video: trainingVideos, module: trainingModules, course: trainingCourses })
    .from(trainingVideos)
    .innerJoin(trainingModules, eq(trainingModules.id, trainingVideos.moduleId))
    .innerJoin(trainingCourses, eq(trainingCourses.id, trainingModules.courseId))
    .where(
      and(
        eq(trainingVideos.id, videoId),
        eq(trainingVideos.status, 'PUBLISHED'),
        eq(trainingModules.status, 'PUBLISHED'),
        eq(trainingCourses.status, 'PUBLISHED')
      )
    );
  return row ?? null;
}
