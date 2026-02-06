import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NatsPublisher } from '../publisher.js';
import { GITHUB_EVENTS_STREAM_CONFIG } from '../stream-config.js';

// Mock NATS objects
function createMockJs() {
  return {
    publish: vi.fn().mockResolvedValue({ stream: 'GITHUB_EVENTS', seq: 1, duplicate: false }),
  };
}

function createMockJsm() {
  return {
    streams: {
      info: vi.fn().mockResolvedValue({ config: { name: 'GITHUB_EVENTS' } }),
      add: vi.fn().mockResolvedValue({ config: { name: 'GITHUB_EVENTS' } }),
    },
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

describe('NatsPublisher', () => {
  let publisher: NatsPublisher;
  let mockJs: ReturnType<typeof createMockJs>;
  let mockJsm: ReturnType<typeof createMockJsm>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockJs = createMockJs();
    mockJsm = createMockJsm();
    mockLogger = createMockLogger();
    publisher = new NatsPublisher(
      mockJs as any,
      mockJsm as any,
      mockLogger,
      GITHUB_EVENTS_STREAM_CONFIG
    );
  });

  it('should publish event to correct subject', async () => {
    const event = {
      eventId: 'evt-123',
      eventType: 'github.notification.created',
      aggregateId: 'owner/repo:PullRequest:42',
      payload: { notificationId: 'n-1', repository: 'owner/repo' },
    };

    await publisher.publish(event);

    expect(mockJs.publish).toHaveBeenCalledWith('github.notification.created', expect.any(String), {
      msgID: 'evt-123',
    });
  });

  it('should use eventId as NATS msgID for deduplication', async () => {
    const event = {
      eventId: 'evt-456',
      eventType: 'github.notification.updated',
      aggregateId: 'owner/repo:Issue:10',
      payload: { some: 'data' },
    };

    await publisher.publish(event);

    const callArgs = mockJs.publish.mock.calls[0];
    expect(callArgs[2]).toEqual({ msgID: 'evt-456' });
  });

  it('should serialize full event as JSON string', async () => {
    const payload = { notificationId: 'n-1', repository: 'owner/repo' };
    const event = {
      eventId: 'evt-789',
      eventType: 'github.notification.created',
      aggregateId: 'agg-1',
      payload,
    };

    await publisher.publish(event);

    const callArgs = mockJs.publish.mock.calls[0];
    expect(JSON.parse(callArgs[1])).toEqual(event);
  });

  it('should ensure stream exists on ensureStream() call', async () => {
    await publisher.ensureStream();

    expect(mockJsm.streams.info).toHaveBeenCalledWith('GITHUB_EVENTS');
  });

  it('should create stream if it does not exist', async () => {
    mockJsm.streams.info.mockRejectedValueOnce(new Error('stream not found'));

    await publisher.ensureStream();

    expect(mockJsm.streams.add).toHaveBeenCalled();
  });

  it('should not re-check stream on subsequent ensureStream() calls', async () => {
    await publisher.ensureStream();
    await publisher.ensureStream();

    expect(mockJsm.streams.info).toHaveBeenCalledTimes(1);
  });

  it('should rethrow non-not-found errors from ensureStream', async () => {
    mockJsm.streams.info.mockRejectedValueOnce(new Error('connection timeout'));

    await expect(publisher.ensureStream()).rejects.toThrow('connection timeout');
    expect(mockJsm.streams.add).not.toHaveBeenCalled();
  });
});

describe('NatsPublisher with custom stream config', () => {
  let publisher: NatsPublisher;
  let mockJs: ReturnType<typeof createMockJs>;
  let mockJsm: ReturnType<typeof createMockJsm>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  const customStreamConfig = {
    name: 'CLAUDE_JOBS',
    subjects: ['claude.job.>'],
    max_age: 604800000000000,
    max_msgs: 100_000,
    storage: 'file' as const,
    num_replicas: 1,
  };

  beforeEach(() => {
    mockJs = createMockJs();
    mockJsm = createMockJsm();
    mockLogger = createMockLogger();
    publisher = new NatsPublisher(mockJs as any, mockJsm as any, mockLogger, customStreamConfig);
  });

  it('should check custom stream name in ensureStream', async () => {
    await publisher.ensureStream();
    expect(mockJsm.streams.info).toHaveBeenCalledWith('CLAUDE_JOBS');
  });

  it('should create custom stream with full config if it does not exist', async () => {
    mockJsm.streams.info.mockRejectedValueOnce(new Error('stream not found'));
    await publisher.ensureStream();
    expect(mockJsm.streams.add).toHaveBeenCalledWith(customStreamConfig);
  });
});
