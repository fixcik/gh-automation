import { db, type OutboxEvent, OutboxRepository } from '@gh-automation/database';
import type { Logger } from '@gh-automation/logger';

export interface ProcessorConfig {
  batchSize: number;
  maxRetries: number;
  processingIntervalMs: number;
}

/**
 * OutboxProcessor обрабатывает события из outbox таблицы:
 * - Читает pending/failed события с SELECT FOR UPDATE SKIP LOCKED
 * - "Публикует" их (для MVP - логирует)
 * - Обновляет статус
 * - Реализует retry логику с exponential backoff
 */
export class OutboxProcessor {
  private readonly repo = new OutboxRepository();
  private isRunning = false;

  constructor(
    private readonly config: ProcessorConfig,
    private readonly logger: Logger
  ) {}

  async processNextBatch(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Already processing, skipping');
      return;
    }

    this.isRunning = true;

    try {
      // Читаем события с FOR UPDATE SKIP LOCKED и помечаем как обрабатываемые
      const events = await db.transaction(async (tx) => {
        const events = await this.repo.fetchPending(this.config.batchSize, tx);
        for (const event of events) {
          await this.repo.markProcessing(event.id, tx);
        }
        return events;
      });

      if (events.length === 0) {
        this.logger.debug('No pending events');
        return;
      }

      this.logger.info({ count: events.length }, 'Processing batch');

      for (const event of events) {
        await this.processEvent(event);
      }

      this.logger.info({ count: events.length }, 'Batch processed');
    } catch (error) {
      this.logger.error({ error }, 'Batch processing error');
    } finally {
      this.isRunning = false;
    }
  }

  private async processEvent(event: OutboxEvent): Promise<void> {
    try {
      // "Публикуем" событие (для MVP - просто логируем)
      await this.publishEvent(event);

      // Помечаем как опубликованное
      await this.repo.markPublished(event.id);

      this.logger.info(
        {
          eventId: event.eventId,
          eventType: event.eventType,
          aggregateId: event.aggregateId,
        },
        'Event published successfully'
      );
    } catch (error) {
      await this.handleError(event, error as Error);
    }
  }

  /**
   * "Публикует" событие
   * В MVP просто логируем, в production - отправка в webhook/Redis/etc
   */
  private async publishEvent(event: OutboxEvent): Promise<void> {
    this.logger.info(
      {
        eventId: event.eventId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        metadata: event.metadata,
      },
      'EVENT PUBLISHED (MVP: logged only)'
    );

    // Simulate async publishing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // В production здесь будет:
    // - HTTP POST на webhook
    // - Redis PUBLISH
    // - Kafka produce
    // etc.
  }

  private async handleError(event: OutboxEvent, error: Error): Promise<void> {
    const errorMessage = error.message;

    this.logger.warn(
      {
        eventId: event.eventId,
        retryCount: event.retryCount,
        maxRetries: event.maxRetries,
        error: errorMessage,
      },
      'Event processing failed'
    );

    // Exponential backoff: 2^retryCount минут
    const retryDelayMinutes = 2 ** (event.retryCount + 1);

    await this.repo.scheduleRetry(event.id, errorMessage, retryDelayMinutes);

    if (event.retryCount + 1 >= event.maxRetries) {
      this.logger.error(
        {
          eventId: event.eventId,
          retryCount: event.retryCount + 1,
        },
        'Event moved to dead letter (max retries exceeded)'
      );
    }
  }
}
