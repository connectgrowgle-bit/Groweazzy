import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { publishStatusEnum } from './enums';

// A lesson cannot be published before its module and course — enforced in
// the publishing service, not just by this column (see docs/ARCHITECTURE.md §10).
export const trainingCourses = pgTable('training_courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description'),
  status: publishStatusEnum('status').notNull().default('DRAFT'),
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const trainingModules = pgTable('training_modules', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id').notNull().references(() => trainingCourses.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull(),
  status: publishStatusEnum('status').notNull().default('DRAFT'),
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  courseIdx: index('training_modules_course_idx').on(t.courseId),
}));

export const trainingVideos = pgTable('training_videos', {
  id: uuid('id').primaryKey().defaultRandom(),
  moduleId: uuid('module_id').notNull().references(() => trainingModules.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull(),
  videoUrl: text('video_url').notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  status: publishStatusEnum('status').notNull().default('DRAFT'),
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  moduleIdx: index('training_videos_module_idx').on(t.moduleId),
}));

// Progress is monotonic (GREATEST(new, old) on write, enforced in the
// service layer since Drizzle can't express GREATEST-on-conflict declaratively),
// sticky once complete, and clamped to the video's own durationSeconds.
// A video completes at 90% watched, not 100%.
export const trainingProgress = pgTable('training_progress', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  videoId: uuid('video_id').notNull().references(() => trainingVideos.id, { onDelete: 'cascade' }),
  secondsWatched: integer('seconds_watched').notNull().default(0),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userVideoUidx: uniqueIndex('training_progress_user_video_uidx').on(t.userId, t.videoId),
}));
