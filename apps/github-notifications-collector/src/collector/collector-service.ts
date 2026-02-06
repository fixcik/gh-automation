import { execa } from 'execa';
import {
  db,
  NotificationRepository,
  OutboxRepository,
  CollectorStateRepository,
} from '@gh-automation/database';
import { Logger } from '@gh-automation/logger';
import { GhNotifyParser } from './gh-notify-parser.js';
import { NotificationProcessor } from './notification-processor.js';
import { OutboxPublisher } from '../publisher/outbox-publisher.js';

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
  private readonly parser = new GhNotifyParser();
  private readonly processor = new NotificationProcessor();
  private readonly notificationRepo = new NotificationRepository();
  private readonly outboxRepo = new OutboxRepository();
  private readonly stateRepo = new CollectorStateRepository();
  private readonly outboxPublisher: OutboxPublisher;

  constructor(
    private readonly config: CollectorConfig,
    private readonly logger: Logger
  ) {
    this.outboxPublisher = new OutboxPublisher(this.outboxRepo, logger);
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
