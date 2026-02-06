import { createLogger } from '@gh-automation/logger';
import { closeDatabase } from '@gh-automation/database';
import { OutboxProcessor } from './outbox-processor.js';

const logger = createLogger('event-processor-worker', '0.0.1');

// Configuration from environment
const config = {
  batchSize: parseInt(process.env.BATCH_SIZE || '100', 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || '5', 10),
  processingIntervalMs: parseInt(process.env.PROCESSOR_INTERVAL_MS || '1000', 10),
};

logger.info({ config }, 'Starting Event Processor Worker');

// Create processor
const processor = new OutboxProcessor(
  {
    batchSize: config.batchSize,
    maxRetries: config.maxRetries,
    processingIntervalMs: config.processingIntervalMs,
  },
  logger
);

// Polling loop
let isShuttingDown = false;

const runLoop = async () => {
  while (!isShuttingDown) {
    try {
      await processor.processNextBatch();
    } catch (error) {
      logger.error({ error }, 'Loop error');
    }

    // Wait before next iteration
    await new Promise((resolve) =>
      setTimeout(resolve, config.processingIntervalMs)
    );
  }
};

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Received shutdown signal');

  isShuttingDown = true;

  // Wait for current batch to finish (max 10s)
  await new Promise((resolve) => setTimeout(resolve, 10000));

  await closeDatabase();

  logger.info('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start loop
runLoop().catch((error) => {
  logger.error({ error }, 'Fatal error');
  process.exit(1);
});

logger.info('Worker started successfully');
