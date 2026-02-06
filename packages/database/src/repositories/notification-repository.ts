import { eq } from 'drizzle-orm';
import { type DbTransaction, db } from '../client';
import {
  type GithubNotification,
  githubNotifications,
  type NewGithubNotification,
} from '../schema';

export class NotificationRepository {
  async insert(data: NewGithubNotification, tx?: DbTransaction): Promise<GithubNotification> {
    const client = tx || db;
    const [notification] = await client.insert(githubNotifications).values(data).returning();
    return notification;
  }

  async upsert(data: NewGithubNotification, tx?: DbTransaction): Promise<GithubNotification> {
    const client = tx || db;
    const [notification] = await client
      .insert(githubNotifications)
      .values(data)
      .onConflictDoUpdate({
        target: githubNotifications.notificationId,
        set: {
          subjectTitle: data.subjectTitle,
          read: data.read,
          updatedAt: data.updatedAt,
          lastSeenAt: new Date(),
        },
      })
      .returning();
    return notification;
  }

  async findByNotificationId(
    notificationId: string,
    tx?: DbTransaction
  ): Promise<GithubNotification | undefined> {
    const client = tx || db;
    const [notification] = await client
      .select()
      .from(githubNotifications)
      .where(eq(githubNotifications.notificationId, notificationId))
      .limit(1);
    return notification;
  }

  async findAll(limit = 100, offset = 0): Promise<GithubNotification[]> {
    return db.select().from(githubNotifications).limit(limit).offset(offset);
  }

  async markAsProcessed(notificationId: string, tx?: DbTransaction): Promise<void> {
    const client = tx || db;
    await client
      .update(githubNotifications)
      .set({ processedAt: new Date() })
      .where(eq(githubNotifications.notificationId, notificationId));
  }
}
