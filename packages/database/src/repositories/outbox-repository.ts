import { EventStatus } from '@gh-automation/shared-types';
import { eq, sql } from 'drizzle-orm';
import { type DbTransaction, db } from '../client';
import { type NewOutboxEvent, type OutboxEvent, outboxEvents } from '../schema';

export class OutboxRepository {
  async insert(data: NewOutboxEvent, tx?: DbTransaction): Promise<OutboxEvent> {
    const client = tx || db;
    const [event] = await client.insert(outboxEvents).values(data).returning();
    return event;
  }

  async fetchPending(batchSize = 100, tx?: DbTransaction): Promise<OutboxEvent[]> {
    const client = tx || db;

    // Using raw SQL for FOR UPDATE SKIP LOCKED
    const events = await client.execute<OutboxEvent>(sql`
      SELECT * FROM ${outboxEvents}
      WHERE ${outboxEvents.status} = ${EventStatus.PENDING}
        AND ${outboxEvents.scheduledAt} <= NOW()
      ORDER BY ${outboxEvents.createdAt} ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `);

    return events as unknown as OutboxEvent[];
  }

  async markProcessing(eventId: number, tx?: DbTransaction): Promise<void> {
    const client = tx || db;
    await client
      .update(outboxEvents)
      .set({
        status: EventStatus.PROCESSING,
      })
      .where(eq(outboxEvents.id, eventId));
  }

  async markPublished(eventId: number, tx?: DbTransaction): Promise<void> {
    const client = tx || db;
    await client
      .update(outboxEvents)
      .set({
        status: EventStatus.PUBLISHED,
        processedAt: new Date(),
      })
      .where(eq(outboxEvents.id, eventId));
  }

  async scheduleRetry(
    eventId: number,
    errorMessage: string,
    retryDelayMinutes: number,
    tx?: DbTransaction
  ): Promise<void> {
    const client = tx || db;

    const [event] = await client
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId))
      .limit(1);

    if (!event) return;

    const newRetryCount = event.retryCount + 1;
    const status = newRetryCount >= event.maxRetries ? EventStatus.FAILED : EventStatus.PENDING;

    await client
      .update(outboxEvents)
      .set({
        status,
        retryCount: newRetryCount,
        errorMessage,
        lastErrorAt: new Date(),
        scheduledAt: sql`NOW() + (${retryDelayMinutes} * INTERVAL '1 minute')`,
      })
      .where(eq(outboxEvents.id, eventId));
  }

  async findById(eventId: number, tx?: DbTransaction): Promise<OutboxEvent | undefined> {
    const client = tx || db;
    const [event] = await client
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId))
      .limit(1);
    return event;
  }

  async countByStatus(status: EventStatus): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(outboxEvents)
      .where(eq(outboxEvents.status, status));
    return Number(result.count);
  }
}
