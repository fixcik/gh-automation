import {
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const githubNotifications = pgTable(
  'github_notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    notificationId: varchar('notification_id', { length: 255 }).notNull().unique(),
    repository: varchar('repository', { length: 255 }).notNull(),
    subjectType: varchar('subject_type', { length: 50 }).notNull(),
    subjectNumber: integer('subject_number'),
    subjectTitle: text('subject_title').notNull(),
    subjectUrl: text('subject_url'),
    reason: varchar('reason', { length: 50 }).notNull(),
    read: boolean('read').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => ({
    repoIdx: index('idx_notifications_repo').on(table.repository),
    updatedAtIdx: index('idx_notifications_updated_at').on(table.updatedAt),
    readIdx: index('idx_notifications_read').on(table.read),
  })
);

export type GithubNotification = typeof githubNotifications.$inferSelect;
export type NewGithubNotification = typeof githubNotifications.$inferInsert;
