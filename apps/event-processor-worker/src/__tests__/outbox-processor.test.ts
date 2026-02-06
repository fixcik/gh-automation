import type { OutboxEvent } from '@gh-automation/database';
import { describe, expect, it } from 'vitest';
import { OutboxProcessor } from '../outbox-processor.js';

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
