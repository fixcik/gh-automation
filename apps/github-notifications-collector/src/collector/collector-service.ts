import {
  CollectorStateRepository,
  db,
  NotificationRepository,
  OutboxRepository,
} from '@gh-automation/database';
import type { Logger } from '@gh-automation/logger';
import { execa } from 'execa';
import { OutboxPublisher } from '../publisher/outbox-publisher.js';
import { GhNotifyParser } from './gh-notify-parser.js';
import { NotificationProcessor } from './notification-processor.js';

export interface CollectorConfig {
  ghNotifyLimit: number;
  ghToken?: string;
}

/**
 * CollectorService оркеструет весь процесс сбора нотификаций:
 * 1. Запускает gh notify
 * 2. Парсит вывод
 * 3. Обрабатывает нотификации
 * 4. Транзакционно сохраняет в БД + публикует события
 * 5. Обновляет состояние коллектора
 */
export class CollectorService {
  private readonly parser: GhNotifyParser;
  private readonly processor: NotificationProcessor;
  private readonly outboxPublisher: OutboxPublisher;

  constructor(
    private readonly config: CollectorConfig,
    private readonly logger: Logger,
    private readonly notificationRepo = new NotificationRepository(),
    private readonly stateRepo = new CollectorStateRepository(),
    outboxRepo = new OutboxRepository()
  ) {
    this.parser = new GhNotifyParser(logger);
    this.processor = new NotificationProcessor();
    this.outboxPublisher = new OutboxPublisher(outboxRepo, logger);
  }

  async collect(): Promise<void> {
    try {
      this.logger.info('Starting notification collection');

      // 1. Запускаем gh notify
      const output = await this.execGhNotify();

      // 2. Парсим
      const parsed = this.parser.parse(output);
      this.logger.info({ count: parsed.length }, 'Parsed notifications');

      if (parsed.length === 0) {
        this.logger.info('No notifications to process');
        await this.updateState(0, 0);
        return;
      }

      // 3. Обрабатываем
      const processed = this.processor.process(parsed);

      // 4. Транзакционно сохраняем + публикуем события
      let savedCount = 0;
      let publishedCount = 0;

      await db.transaction(async (tx) => {
        for (const notification of processed) {
          // Upsert нотификации
          const saved = await this.notificationRepo.upsert(notification, tx);

          // Публикуем событие в outbox
          await this.outboxPublisher.publish(saved, tx);

          savedCount++;
          publishedCount++;
        }
      });

      this.logger.info(
        {
          saved: savedCount,
          published: publishedCount,
        },
        'Notifications saved and events published'
      );

      // 5. Обновляем состояние
      await this.updateState(savedCount, publishedCount);

      this.logger.info('Collection completed successfully');
    } catch (error) {
      this.logger.error({ error }, 'Collection failed');
      throw error;
    }
  }

  private async execGhNotify(): Promise<string> {
    const args = ['notify', '-an', String(this.config.ghNotifyLimit), '-s'];

    this.logger.debug({ args }, 'Executing gh notify');

    const { stdout } = await execa('gh', args, {
      timeout: 60_000, // 60s timeout to prevent indefinite hang
      env: {
        ...process.env,
        ...(this.config.ghToken && { GH_TOKEN: this.config.ghToken }),
      },
    });

    return stdout;
  }

  private async updateState(collected: number, published: number): Promise<void> {
    await this.stateRepo.incrementCounters(collected, published);
  }
}
