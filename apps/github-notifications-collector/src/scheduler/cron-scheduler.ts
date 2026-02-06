import type { Logger } from '@gh-automation/logger';
import cron from 'node-cron';
import type { CollectorService } from '../collector/collector-service.js';

export interface SchedulerConfig {
  schedule: string; // Cron expression, e.g., '*/5 * * * *'
}

/**
 * CronScheduler управляет периодическим запуском CollectorService
 */
export class CronScheduler {
  private task: cron.ScheduledTask | null = null;
  private isRunning = false;
  private runningPromise: Promise<void> | null = null;

  constructor(
    private readonly config: SchedulerConfig,
    private readonly collector: CollectorService,
    private readonly logger: Logger
  ) {}

  start(): void {
    if (this.task) {
      this.logger.warn('Scheduler already running');
      return;
    }

    // Валидируем cron expression
    if (!cron.validate(this.config.schedule)) {
      throw new Error(`Invalid cron expression: ${this.config.schedule}`);
    }

    this.logger.info({ schedule: this.config.schedule }, 'Starting cron scheduler');

    this.task = cron.schedule(this.config.schedule, async () => {
      await this.runCollection();
    });

    // Запускаем первый сбор сразу
    this.runCollection();
  }

  async stop(): Promise<void> {
    if (this.task) {
      this.logger.info('Stopping cron scheduler');
      this.task.stop();
      this.task = null;
    }
    if (this.runningPromise) {
      this.logger.info('Waiting for in-progress collection to complete');
      await this.runningPromise;
    }
  }

  private async runCollection(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Collection already in progress, skipping');
      return;
    }

    this.runningPromise = this._doCollection();
    return this.runningPromise;
  }

  private async _doCollection(): Promise<void> {
    try {
      this.isRunning = true;
      await this.collector.collect();
    } catch (error) {
      this.logger.error({ error }, 'Collection error');
    } finally {
      this.isRunning = false;
      this.runningPromise = null;
    }
  }
}
