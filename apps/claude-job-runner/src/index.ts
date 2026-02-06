import { createLogger } from '@gh-automation/logger';
import {
  CLAUDE_JOBS_STREAM_CONFIG,
  CLAUDE_JOBS_STREAM_NAME,
  closeNatsConnection,
  createNatsPublisher,
  createNatsSubscriber,
  getNatsConnection,
} from '@gh-automation/nats';
import { ClaudeConfigBuilder } from './claude-config-builder.js';
import { ClaudeRunner } from './claude-runner.js';
import { CloneManager } from './clone-manager.js';
import { loadConfig } from './config.js';
import { JobConsumer } from './job-consumer.js';
import { JobExecutor } from './job-executor.js';

const logger = createLogger('claude-job-runner', '0.0.1');
const config = loadConfig(logger);

let isShuttingDown = false;
let jobConsumer: JobConsumer | null = null;

const initialize = async () => {
  if (!config.natsUrl) {
    throw new Error('NATS_URL is required');
  }

  const nc = await getNatsConnection({ url: config.natsUrl }, logger);
  const publisher = await createNatsPublisher(nc, logger, CLAUDE_JOBS_STREAM_CONFIG);
  const subscriber = await createNatsSubscriber(nc, logger, CLAUDE_JOBS_STREAM_NAME);

  const cloneManager = new CloneManager(config.cloneBaseDir, config.cacheBaseDir, logger);
  const claudeRunner = new ClaudeRunner(logger);
  const configBuilder = new ClaudeConfigBuilder();

  const executor = new JobExecutor({
    cloneManager,
    claudeRunner,
    configBuilder,
    publisher,
    logger,
    natsUrl: config.natsUrl,
  });

  jobConsumer = new JobConsumer(subscriber, logger, {
    consumerName: config.consumerName,
    ackWaitMs: config.ackWaitMs,
    filterSubject: 'claude.job.request.>',
  });

  await jobConsumer.init();

  return { consumer: jobConsumer, executor };
};

const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Received shutdown signal');

  if (jobConsumer) {
    await jobConsumer.stop();
  }

  try {
    await closeNatsConnection(logger);
  } catch (error) {
    logger.warn({ error }, 'Failed to close NATS connection');
  }

  logger.info('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

initialize()
  .then(async ({ consumer, executor }) => {
    logger.info('Claude Job Runner started successfully');
    await consumer.listen(async (request) => {
      await executor.execute(request);
    });
  })
  .catch((error) => {
    logger.error({ error }, 'Fatal error during initialization');
    process.exit(1);
  });
