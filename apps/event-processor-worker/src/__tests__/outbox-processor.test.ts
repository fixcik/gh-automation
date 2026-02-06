import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gh-automation/database', () => {
  const mockRepo = {
    fetchPending: vi.fn().mockResolvedValue([]),
    markProcessing: vi.fn().mockResolvedValue(undefined),
    markPublished: vi.fn().mockResolvedValue(undefined),
    scheduleRetry: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: { transaction: vi.fn(async (fn: any) => fn({} as any)) },
    OutboxRepository: vi.fn(() => mockRepo),
    __mockRepo: mockRepo,
  };
});

import type { OutboxEvent } from '@gh-automation/database';
import * as dbModule from '@gh-automation/database';
import { OutboxProcessor } from '../outbox-processor.js';

const getMockRepo = () => (dbModule as any).__mockRepo;

function createOutboxEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: 1,
    eventId: 'evt-uuid-123',
    eventType: 'github.notification.created',
    aggregateType: 'github_notification',
    aggregateId: 'owner/repo:PullRequest:42',
    payload: { notificationId: 'n-1', repository: 'owner/repo' },
    metadata: null,
    status: 'PROCESSING',
    retryCount: 0,
    maxRetries: 5,
    createdAt: '2025-01-15T10:00:00.000Z',
    scheduledAt: '2025-01-15T10:00:00.000Z',
    processedAt: null,
    errorMessage: null,
    lastErrorAt: null,
    ...overrides,
  } as OutboxEvent;
}

describe('OutboxProcessor.mapToPublishableEvent', () => {
  it('should map OutboxEvent to PublishableEvent with correct fields', () => {
    const event = createOutboxEvent();
    const result = OutboxProcessor.mapToPublishableEvent(event);

    expect(result).toEqual({
      eventId: 'evt-uuid-123',
      eventType: 'github.notification.created',
      aggregateId: 'owner/repo:PullRequest:42',
      payload: { notificationId: 'n-1', repository: 'owner/repo' },
      metadata: {
        aggregateType: 'github_notification',
        createdAt: '2025-01-15T10:00:00.000Z',
      },
    });
  });

  it('should merge existing metadata with aggregateType and createdAt', () => {
    const event = createOutboxEvent({
      metadata: { source: 'collector', version: 1 },
    });
    const result = OutboxProcessor.mapToPublishableEvent(event);

    expect(result.metadata).toEqual({
      source: 'collector',
      version: 1,
      aggregateType: 'github_notification',
      createdAt: '2025-01-15T10:00:00.000Z',
    });
  });

  it('should handle null metadata', () => {
    const event = createOutboxEvent({ metadata: null });
    const result = OutboxProcessor.mapToPublishableEvent(event);

    expect(result.metadata).toEqual({
      aggregateType: 'github_notification',
      createdAt: '2025-01-15T10:00:00.000Z',
    });
  });
});

function createMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

function createMockPublisher() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

describe('OutboxProcessor publishing', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockPublisher: ReturnType<typeof createMockPublisher>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockPublisher = createMockPublisher();
    vi.clearAllMocks();
  });

  it('should call publisher.publish with mapped event', async () => {
    const event = createOutboxEvent();
    getMockRepo().fetchPending.mockResolvedValueOnce([event]);

    const processor = new OutboxProcessor(
      { batchSize: 10, processingIntervalMs: 1000 },
      mockLogger,
      mockPublisher
    );
    await processor.processNextBatch();

    expect(mockPublisher.publish).toHaveBeenCalledWith({
      eventId: 'evt-uuid-123',
      eventType: 'github.notification.created',
      aggregateId: 'owner/repo:PullRequest:42',
      payload: { notificationId: 'n-1', repository: 'owner/repo' },
      metadata: {
        aggregateType: 'github_notification',
        createdAt: '2025-01-15T10:00:00.000Z',
      },
    });
  });

  it('should mark event as published after successful publish', async () => {
    const event = createOutboxEvent();
    getMockRepo().fetchPending.mockResolvedValueOnce([event]);

    const processor = new OutboxProcessor(
      { batchSize: 10, processingIntervalMs: 1000 },
      mockLogger,
      mockPublisher
    );
    await processor.processNextBatch();

    expect(getMockRepo().markPublished).toHaveBeenCalledWith(1);
  });

  it('should schedule retry when publisher.publish throws', async () => {
    const event = createOutboxEvent();
    getMockRepo().fetchPending.mockResolvedValueOnce([event]);
    mockPublisher.publish.mockRejectedValueOnce(new Error('NATS timeout'));

    const processor = new OutboxProcessor(
      { batchSize: 10, processingIntervalMs: 1000 },
      mockLogger,
      mockPublisher
    );
    await processor.processNextBatch();

    expect(getMockRepo().scheduleRetry).toHaveBeenCalledWith(1, 'NATS timeout', 2);
    expect(getMockRepo().markPublished).not.toHaveBeenCalled();
  });

  it('should fall back to log-only when no publisher provided', async () => {
    const event = createOutboxEvent();
    getMockRepo().fetchPending.mockResolvedValueOnce([event]);

    const processor = new OutboxProcessor(
      { batchSize: 10, processingIntervalMs: 1000 },
      mockLogger
    );
    await processor.processNextBatch();

    expect(getMockRepo().markPublished).toHaveBeenCalledWith(1);
  });
});
