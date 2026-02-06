import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobConsumer } from '../job-consumer.js';

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
});

const createMockSubscriber = () => ({
  ensureConsumer: vi.fn(),
  getConsumer: vi.fn(),
});

const createMockMsg = (data: unknown) => ({
  string: () => JSON.stringify(data),
  subject: 'claude.job.request.pr-review',
  ack: vi.fn(),
  nak: vi.fn(),
  working: vi.fn(),
});

describe('JobConsumer', () => {
  let consumer: JobConsumer;
  let mockSubscriber: ReturnType<typeof createMockSubscriber>;
  let logger: ReturnType<typeof createMockLogger>;

  const config = {
    consumerName: 'claude-job-runner',
    ackWaitMs: 900_000,
    filterSubject: 'claude.job.request.>',
  };

  beforeEach(() => {
    mockSubscriber = createMockSubscriber();
    logger = createMockLogger();
    consumer = new JobConsumer(mockSubscriber as any, logger as any, config);
  });

  describe('init', () => {
    it('should call ensureConsumer with correct config', async () => {
      await consumer.init();

      expect(mockSubscriber.ensureConsumer).toHaveBeenCalledWith('claude-job-runner', {
        ackWaitMs: 900_000,
        filterSubject: 'claude.job.request.>',
      });
    });
  });

  describe('parseMessage', () => {
    it('should parse valid PublishableEvent with ClaudeJobRequest payload', () => {
      const msg = createMockMsg({
        eventId: 'evt-1',
        eventType: 'claude.job.request.pr-review',
        payload: {
          jobId: 'job-1',
          jobType: 'pr-review',
          prompt: 'Review this PR',
          repository: { url: 'https://github.com/owner/repo.git' },
          claude: {},
          communication: { enableNotifications: true, enableAskUser: false },
          metadata: {},
          createdAt: '2026-01-01T00:00:00Z',
        },
      });

      const result = consumer.parseMessage(msg as any);

      expect(result).not.toBeNull();
      expect(result!.jobId).toBe('job-1');
      expect(result!.prompt).toBe('Review this PR');
    });

    it('should return null for invalid JSON', () => {
      const msg = {
        string: () => 'not json',
        subject: 'claude.job.request.pr-review',
      };

      const result = consumer.parseMessage(msg as any);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should return null for message without required fields', () => {
      const msg = createMockMsg({
        payload: { jobId: 'job-1' }, // missing jobType and prompt
      });

      const result = consumer.parseMessage(msg as any);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should return null for message with empty payload', () => {
      const msg = createMockMsg({ payload: {} });

      const result = consumer.parseMessage(msg as any);

      expect(result).toBeNull();
    });
  });
});
