import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NatsSubscriber } from '../subscriber.js';

function createMockConsumer() {
  return {
    consume: vi.fn(),
  };
}

function createMockJsm() {
  return {
    consumers: {
      info: vi.fn().mockResolvedValue({ name: 'test-consumer' }),
      add: vi.fn().mockResolvedValue({ name: 'test-consumer' }),
    },
    streams: {
      info: vi.fn().mockResolvedValue({ config: { name: 'GITHUB_EVENTS' } }),
      add: vi.fn().mockResolvedValue({ config: { name: 'GITHUB_EVENTS' } }),
    },
  };
}

function createMockJs() {
  const mockConsumer = createMockConsumer();
  return {
    consumers: {
      get: vi.fn().mockResolvedValue(mockConsumer),
    },
    _mockConsumer: mockConsumer,
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

describe('NatsSubscriber', () => {
  let subscriber: NatsSubscriber;
  let mockJs: ReturnType<typeof createMockJs>;
  let mockJsm: ReturnType<typeof createMockJsm>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockJs = createMockJs();
    mockJsm = createMockJsm();
    mockLogger = createMockLogger();
    subscriber = new NatsSubscriber(mockJs as any, mockJsm as any, mockLogger);
  });

  it('should ensure consumer exists before subscribing', async () => {
    mockJsm.consumers.info.mockRejectedValueOnce(new Error('consumer not found'));

    await subscriber.ensureConsumer('my-service');

    expect(mockJsm.consumers.add).toHaveBeenCalledWith(
      'GITHUB_EVENTS',
      expect.objectContaining({
        durable_name: 'my-service',
        ack_policy: expect.any(String),
        deliver_policy: expect.any(String),
        max_ack_pending: expect.any(Number),
      })
    );
  });

  it('should rethrow non-not-found errors from ensureConsumer', async () => {
    mockJsm.consumers.info.mockRejectedValueOnce(new Error('connection timeout'));

    await expect(subscriber.ensureConsumer('my-service')).rejects.toThrow('connection timeout');
    expect(mockJsm.consumers.add).not.toHaveBeenCalled();
  });

  it('should not recreate consumer if it already exists', async () => {
    await subscriber.ensureConsumer('my-service');

    expect(mockJsm.consumers.info).toHaveBeenCalledWith('GITHUB_EVENTS', 'my-service');
    expect(mockJsm.consumers.add).not.toHaveBeenCalled();
  });

  it('should get consumer from jetstream', async () => {
    await subscriber.ensureConsumer('my-service');
    const consumer = await subscriber.getConsumer('my-service');

    expect(mockJs.consumers.get).toHaveBeenCalledWith('GITHUB_EVENTS', 'my-service');
    expect(consumer).toBeDefined();
  });
});

describe('NatsSubscriber with custom stream name', () => {
  let subscriber: NatsSubscriber;
  let mockJs: ReturnType<typeof createMockJs>;
  let mockJsm: ReturnType<typeof createMockJsm>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockJs = createMockJs();
    mockJsm = createMockJsm();
    mockLogger = createMockLogger();
    subscriber = new NatsSubscriber(mockJs as any, mockJsm as any, mockLogger, 'CLAUDE_JOBS');
  });

  it('should use custom stream name for ensureConsumer', async () => {
    mockJsm.consumers.info.mockRejectedValueOnce(new Error('consumer not found'));
    await subscriber.ensureConsumer('job-runner');
    expect(mockJsm.consumers.add).toHaveBeenCalledWith(
      'CLAUDE_JOBS',
      expect.objectContaining({ durable_name: 'job-runner' })
    );
  });

  it('should use custom stream name for getConsumer', async () => {
    await subscriber.getConsumer('job-runner');
    expect(mockJs.consumers.get).toHaveBeenCalledWith('CLAUDE_JOBS', 'job-runner');
  });

  it('should use default GITHUB_EVENTS when no name provided', async () => {
    const defaultSubscriber = new NatsSubscriber(mockJs as any, mockJsm as any, mockLogger);
    await defaultSubscriber.ensureConsumer('my-service');
    expect(mockJsm.consumers.info).toHaveBeenCalledWith('GITHUB_EVENTS', 'my-service');
  });
});
