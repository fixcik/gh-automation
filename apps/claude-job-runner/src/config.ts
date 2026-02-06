import type { Logger } from '@gh-automation/logger';

export interface RunnerConfig {
  natsUrl: string;
  consumerName: string;
  ackWaitMs: number;
  cloneBaseDir: string;
  cacheBaseDir: string;
  logLevel: string;
  maxConcurrentJobs: number;
}

const parsePositiveInt = (
  value: string | undefined,
  fallback: number,
  name: string,
  logger: Logger
): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn({ value, fallback }, `Invalid ${name}; using default`);
    return fallback;
  }
  return parsed;
};

export function loadConfig(logger: Logger): RunnerConfig {
  const natsUrl = process.env.NATS_URL || '';
  if (!natsUrl) {
    logger.warn('NATS_URL not set');
  }

  return {
    natsUrl,
    consumerName: process.env.NATS_CONSUMER_NAME || 'claude-job-runner',
    ackWaitMs: parsePositiveInt(process.env.NATS_ACK_WAIT_MS, 900_000, 'NATS_ACK_WAIT_MS', logger),
    cloneBaseDir: process.env.CLONE_BASE_DIR || '/tmp/claude-jobs',
    cacheBaseDir: process.env.CACHE_BASE_DIR || '/data/cache',
    logLevel: process.env.LOG_LEVEL || 'info',
    maxConcurrentJobs: parsePositiveInt(
      process.env.MAX_CONCURRENT_JOBS,
      1,
      'MAX_CONCURRENT_JOBS',
      logger
    ),
  };
}
