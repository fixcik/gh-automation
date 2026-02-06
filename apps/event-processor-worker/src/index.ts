import { closeDatabase } from '@gh-automation/database';
import { createLogger } from '@gh-automation/logger';
import {
  closeNatsConnection,
  createNatsPublisher,
  getNatsConnection,
  STREAM_CONFIG,
} from '@gh-automation/nats';
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
  processingIntervalMs: parsePositiveInt(
    process.env.PROCESSOR_INTERVAL_MS,
    1000,
    'PROCESSOR_INTERVAL_MS'
  ),
  natsUrl: process.env.NATS_URL || '',
};

logger.info({ config }, 'Starting Event Processor Worker');

// Create processor with optional NATS publisher
const initializeProcessor = async (): Promise<OutboxProcessor> => {
  if (!config.natsUrl) {
    logger.warn('NATS_URL not set — running in log-only mode');
    return new OutboxProcessor(
      { batchSize: config.batchSize, processingIntervalMs: config.processingIntervalMs },
      logger
    );
  }

  const nc = await getNatsConnection({ url: config.natsUrl }, logger);
  const publisher = await createNatsPublisher(nc, logger, STREAM_CONFIG);
  logger.info('NATS publisher initialized');

  return new OutboxProcessor(
    { batchSize: config.batchSize, processingIntervalMs: config.processingIntervalMs },
    logger,
    publisher
  );
};

// Polling loop
let isShuttingDown = false;
let inFlight: Promise<void> | null = null;

const runLoop = async (processor: OutboxProcessor) => {
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

  try {
    await closeNatsConnection(logger);
  } catch (error) {
    logger.warn({ error }, 'Failed to close NATS connection');
  }

  try {
    await closeDatabase();
  } catch (error) {
    logger.error({ error }, 'Failed to close database');
  }

  logger.info('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Initialize and start
initializeProcessor()
  .then((processor) => {
    logger.info('Worker started successfully');
    return runLoop(processor);
  })
  .catch((error) => {
    logger.error({ error }, 'Fatal error during initialization');
    process.exit(1);
  });
