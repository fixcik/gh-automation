import { closeDatabase } from '@gh-automation/database';
import { createLogger } from '@gh-automation/logger';
import { OutboxProcessor } from './outbox-processor.js';

const logger = createLogger('event-processor-worker', '0.0.1');

const parsePositiveInt = (value: string | undefined, fallback: number, name: string) => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn({ value }, `Invalid ${name}; using default ${fallback}`);
    return fallback;
  }
  return parsed;
};

// Configuration from environment
const config = {
  batchSize: parsePositiveInt(process.env.BATCH_SIZE, 100, 'BATCH_SIZE'),
  maxRetries: parsePositiveInt(process.env.MAX_RETRIES, 5, 'MAX_RETRIES'),
  processingIntervalMs: parsePositiveInt(
    process.env.PROCESSOR_INTERVAL_MS,
    1000,
    'PROCESSOR_INTERVAL_MS'
  ),
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
let inFlight: Promise<void> | null = null;

const runLoop = async () => {
  while (!isShuttingDown) {
    try {
      inFlight = processor.processNextBatch();
      await inFlight;
    } catch (error) {
      logger.error({ error }, 'Loop error');
    } finally {
      inFlight = null;
    }

    // Wait before next iteration
    await new Promise((resolve) => setTimeout(resolve, config.processingIntervalMs));
  }
};

// Graceful shutdown
const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  logger.info({ signal }, 'Received shutdown signal');

  isShuttingDown = true;

  // Wait for current batch to finish (max 10s)
  const timeout = new Promise((resolve) => setTimeout(resolve, 10000));
  if (inFlight) {
    await Promise.race([inFlight, timeout]);
  } else {
    await timeout;
  }

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
