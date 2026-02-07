import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
});

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return defaults when no env vars set', () => {
    delete process.env.NATS_URL;
    delete process.env.NATS_CONSUMER_NAME;
    delete process.env.NATS_ACK_WAIT_MS;
    delete process.env.CLONE_BASE_DIR;
    delete process.env.MAX_CONCURRENT_JOBS;

    const logger = createMockLogger();
    const config = loadConfig(logger as any);

    expect(config.natsUrl).toBe('');
    expect(config.consumerName).toBe('claude-job-runner');
    expect(config.ackWaitMs).toBe(900_000);
    expect(config.cloneBaseDir).toBe('/tmp/claude-jobs');
    expect(config.maxConcurrentJobs).toBe(1);
  });

  it('should parse env vars correctly', () => {
    process.env.NATS_URL = 'nats://custom:4222';
    process.env.NATS_CONSUMER_NAME = 'my-runner';
    process.env.NATS_ACK_WAIT_MS = '600000';
    process.env.CLONE_BASE_DIR = '/custom/clone';
    process.env.MAX_CONCURRENT_JOBS = '3';

    const logger = createMockLogger();
    const config = loadConfig(logger as any);

    expect(config.natsUrl).toBe('nats://custom:4222');
    expect(config.consumerName).toBe('my-runner');
    expect(config.ackWaitMs).toBe(600_000);
    expect(config.cloneBaseDir).toBe('/custom/clone');
    expect(config.maxConcurrentJobs).toBe(3);
  });

  it('should warn and use defaults for invalid numeric values', () => {
    process.env.NATS_URL = 'nats://localhost:4222'; // Set to avoid NATS_URL warn
    process.env.NATS_ACK_WAIT_MS = 'not-a-number';
    process.env.MAX_CONCURRENT_JOBS = '-5';

    const logger = createMockLogger();
    const config = loadConfig(logger as any);

    expect(config.ackWaitMs).toBe(900_000);
    expect(config.maxConcurrentJobs).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(2); // Only numeric validation warnings
  });

  it('should warn when NATS_URL not set', () => {
    delete process.env.NATS_URL;

    const logger = createMockLogger();
    loadConfig(logger as any);

    expect(logger.warn).toHaveBeenCalledWith('NATS_URL not set');
  });
});
