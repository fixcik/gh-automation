import { eq, sql } from 'drizzle-orm';
import { type DbTransaction, db } from '../client';
import { type CollectorState, collectorState, type UpdateCollectorState } from '../schema';

export class CollectorStateRepository {
  async get(tx?: DbTransaction): Promise<CollectorState | undefined> {
    const client = tx || db;
    const [state] = await client
      .select()
      .from(collectorState)
      .where(eq(collectorState.id, 1))
      .limit(1);
    return state;
  }

  async initialize(tx?: DbTransaction): Promise<CollectorState> {
    const client = tx || db;
    const [state] = await client
      .insert(collectorState)
      .values({ id: 1 })
      .onConflictDoNothing()
      .returning();

    if (!state) {
      return (await this.get(tx))!;
    }

    return state;
  }

  async updateSuccessfulRun(
    updates: Partial<UpdateCollectorState>,
    tx?: DbTransaction
  ): Promise<CollectorState> {
    const client = tx || db;
    const current = await this.get(tx);

    if (!current) {
      await this.initialize(tx);
    }

    const [state] = await client
      .update(collectorState)
      .set({
        ...updates,
        lastSuccessfulRun: new Date(),
      })
      .where(eq(collectorState.id, 1))
      .returning();
    return state;
  }

  async incrementCounters(collected: number, published: number, tx?: DbTransaction): Promise<void> {
    const client = tx || db;

    // Ensure state row exists
    await this.initialize(tx);

    await client
      .update(collectorState)
      .set({
        totalCollected: sql`COALESCE(${collectorState.totalCollected}, 0) + ${collected}`,
        totalPublished: sql`COALESCE(${collectorState.totalPublished}, 0) + ${published}`,
      })
      .where(eq(collectorState.id, 1));
  }
}
