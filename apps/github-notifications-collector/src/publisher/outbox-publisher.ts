import {
  GithubNotification,
  OutboxRepository,
  DbTransaction,
} from '@gh-automation/database';
import { GithubNotificationEvent, EventStatus } from '@gh-automation/shared-types';
import { Logger } from '@gh-automation/logger';

/**
 * OutboxPublisher публикует события в outbox таблицу
 * В одной транзакции с сохранением нотификации
 */
export class OutboxPublisher {
  constructor(
    private readonly outboxRepo: OutboxRepository,
    private readonly logger: Logger
  ) {}

  /**
   * Публикует событие создания/обновления нотификации
   * ВАЖНО: вызывать только внутри транзакции вместе с сохранением нотификации
   */
  async publish(notification: GithubNotification, tx: DbTransaction): Promise<void> {
    const event = this.createEvent(notification);

    await this.outboxRepo.insert(
      {
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload as any,
        metadata: event.metadata as any,
        status: EventStatus.PENDING,
        retryCount: 0,
        maxRetries: 5,
      },
      tx
    );

    this.logger.debug(
      {
        notificationId: notification.notificationId,
        eventType: event.eventType,
      },
      'Event published to outbox'
    );
  }

  /**
   * Публикует несколько событий в одной транзакции
   */
  async publishBatch(notifications: GithubNotification[], tx: DbTransaction): Promise<void> {
    for (const notification of notifications) {
      await this.publish(notification, tx);
    }

    this.logger.info(
      {
        count: notifications.length,
      },
      'Batch of events published to outbox'
    );
  }

  /**
   * Создаёт событие из нотификации
   */
  private createEvent(notification: GithubNotification): GithubNotificationEvent {
    // Определяем тип события: created если первый раз, updated если уже видели
    const isNew = notification.firstSeenAt.getTime() === notification.lastSeenAt.getTime();
    const eventType = isNew
      ? ('github.notification.created' as const)
      : ('github.notification.updated' as const);

    return {
      eventId: '', // Будет сгенерирован в БД
      eventType,
      aggregateType: 'GithubNotification',
      aggregateId: notification.notificationId,
      payload: {
        notificationId: notification.notificationId,
        repository: notification.repository,
        subjectType: notification.subjectType as any,
        subjectNumber: notification.subjectNumber,
        subjectTitle: notification.subjectTitle,
        subjectUrl: notification.subjectUrl,
        reason: notification.reason as any,
        read: notification.read,
        updatedAt: notification.updatedAt,
        firstSeenAt: notification.firstSeenAt,
        lastSeenAt: notification.lastSeenAt,
      },
      metadata: {
        source: 'gh-notify-collector',
      },
      createdAt: new Date(),
    };
  }
}
