import { sql } from 'drizzle-orm';
import { bigint, check, integer, pgTable, timestamp } from 'drizzle-orm/pg-core';

export const collectorState = pgTable(
  'collector_state',
  {
    id: integer('id').primaryKey().default(1),
    lastSuccessfulRun: timestamp('last_successful_run', { withTimezone: true }),
    lastNotificationUpdatedAt: timestamp('last_notification_updated_at', { withTimezone: true }),
    totalCollected: bigint('total_collected', { mode: 'number' }).default(0),
    totalPublished: bigint('total_published', { mode: 'number' }).default(0),
  },
  (table) => ({
    singleRowCheck: check('single_row', sql`${table.id} = 1`),
  })
);

export type CollectorState = typeof collectorState.$inferSelect;
export type UpdateCollectorState = typeof collectorState.$inferInsert;
