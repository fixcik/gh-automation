import { closeDatabase } from '@gh-automation/database';
import { createLogger } from '@gh-automation/logger';
import { CollectorService } from './collector/collector-service.js';
import { CronScheduler } from './scheduler/cron-scheduler.js';

const logger = createLogger('github-notifications-collector', '0.0.1');

// Configuration from environment
const config = {
  ghNotifyLimit: parseInt(process.env.GH_NOTIFY_LIMIT || '100', 10),
  ghToken: process.env.GH_TOKEN,
  schedule: process.env.COLLECTOR_SCHEDULE || '*/5 * * * *',
};

const safeConfig = {
  ...config,
  ghToken: config.ghToken ? '***' : undefined,
};
logger.info({ config: safeConfig }, 'Starting GitHub Notifications Collector');

// Create services
const collector = new CollectorService(
  {
    ghNotifyLimit: config.ghNotifyLimit,
    ghToken: config.ghToken,
  },
  logger
);

const scheduler = new CronScheduler(
  {
    schedule: config.schedule,
  },
  collector,
  logger
);

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Received shutdown signal');

  scheduler.stop();
  await closeDatabase();

  logger.info('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start scheduler
scheduler.start();

logger.info('Collector started successfully');
