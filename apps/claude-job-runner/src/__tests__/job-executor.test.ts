import type { ClaudeJobRequest } from '@gh-automation/shared-types';
import { JobType } from '@gh-automation/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobExecutor } from '../job-executor.js';

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
});

const createMockCloneManager = () => ({
  clone: vi.fn().mockResolvedValue('/tmp/clone/job-test-1'),
  cleanup: vi.fn().mockResolvedValue(undefined),
  restoreCache: vi.fn().mockResolvedValue(undefined),
  saveCache: vi.fn().mockResolvedValue(undefined),
});

const createMockClaudeRunner = () => ({
  run: vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: '{"result": "All done"}',
    stderr: '',
  }),
});

const createMockConfigBuilder = () => ({
  buildArgs: vi.fn().mockReturnValue(['-p', '--output-format', 'json', '--model', 'sonnet']),
  buildMcpConfig: vi.fn().mockResolvedValue('/tmp/clone/job-test-1/.mcp.json'),
});

const createMockPublisher = () => ({
  publish: vi.fn().mockResolvedValue(undefined),
  ensureStream: vi.fn().mockResolvedValue(undefined),
});

const createTestRequest = (overrides?: Partial<ClaudeJobRequest>): ClaudeJobRequest => ({
  jobId: 'test-job-1',
  jobType: JobType.PR_REVIEW,
  prompt: 'Review this PR',
  repository: {
    url: 'https://github.com/owner/repo.git',
    branch: 'feature/test',
  },
  claude: {
    model: 'sonnet',
    maxTurns: 50,
    timeoutMs: 300_000,
  },
  communication: {
    enableNotifications: true,
    enableAskUser: false,
  },
  metadata: {
    repository: 'owner/repo',
    prNumber: 42,
  },
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('JobExecutor', () => {
  let executor: JobExecutor;
  let mocks: {
    cloneManager: ReturnType<typeof createMockCloneManager>;
    claudeRunner: ReturnType<typeof createMockClaudeRunner>;
    configBuilder: ReturnType<typeof createMockConfigBuilder>;
    publisher: ReturnType<typeof createMockPublisher>;
    logger: ReturnType<typeof createMockLogger>;
  };

  beforeEach(() => {
    mocks = {
      cloneManager: createMockCloneManager(),
      claudeRunner: createMockClaudeRunner(),
      configBuilder: createMockConfigBuilder(),
      publisher: createMockPublisher(),
      logger: createMockLogger(),
    };

    executor = new JobExecutor({
      ...mocks,
      natsUrl: 'nats://localhost:4222',
    } as any);
  });

  it('should execute full pipeline: clone -> configure -> run -> publish -> cleanup', async () => {
    const request = createTestRequest();

    const result = await executor.execute(request);

    // 1. Clone
    expect(mocks.cloneManager.clone).toHaveBeenCalledWith('test-job-1', request.repository);

    // 2. Build args
    expect(mocks.configBuilder.buildArgs).toHaveBeenCalledWith(request.claude);

    // 3. Build MCP config (enableNotifications = true)
    expect(mocks.configBuilder.buildMcpConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'test-job-1',
        jobType: 'pr-review',
      })
    );

    // 4. Run Claude
    expect(mocks.claudeRunner.run).toHaveBeenCalledWith(
      'Review this PR',
      '/tmp/clone/job-test-1',
      expect.any(Array),
      300_000
    );

    // 5. Publish result
    expect(mocks.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'claude.job.result.pr-review',
        aggregateId: 'test-job-1',
      })
    );

    // 6. Cleanup
    expect(mocks.cloneManager.cleanup).toHaveBeenCalledWith('/tmp/clone/job-test-1');

    // 7. Result
    expect(result.status).toBe('completed');
    expect(result.jobId).toBe('test-job-1');
  });

  it('should not build MCP config when communication is disabled', async () => {
    const request = createTestRequest({
      communication: { enableNotifications: false, enableAskUser: false },
    });

    await executor.execute(request);

    expect(mocks.configBuilder.buildMcpConfig).not.toHaveBeenCalled();
  });

  it('should return failed result when Claude exits with non-zero code', async () => {
    mocks.claudeRunner.run.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'Claude error',
    });

    const result = await executor.execute(createTestRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('Claude error');
    expect(result.error?.exitCode).toBe(1);
  });

  it('should return timeout result when Claude times out', async () => {
    mocks.claudeRunner.run.mockResolvedValue({
      exitCode: -1,
      stdout: '',
      stderr: 'Process timed out after 300000ms',
    });

    const result = await executor.execute(createTestRequest());

    expect(result.status).toBe('timeout');
    expect(result.error?.exitCode).toBe(-1);
  });

  it('should return failed result and still publish when clone fails', async () => {
    mocks.cloneManager.clone.mockRejectedValue(new Error('git clone failed'));

    const result = await executor.execute(createTestRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('git clone failed');

    // Still publishes the error result
    expect(mocks.publisher.publish).toHaveBeenCalled();
  });

  it('should always cleanup even on failure', async () => {
    mocks.claudeRunner.run.mockRejectedValue(new Error('unexpected'));

    await executor.execute(createTestRequest());

    expect(mocks.cloneManager.cleanup).toHaveBeenCalledWith('/tmp/clone/job-test-1');
  });

  it('should handle cache restore and save', async () => {
    const request = createTestRequest({
      cache: { paths: ['.pr-threads-cache'] },
    });

    await executor.execute(request);

    expect(mocks.cloneManager.restoreCache).toHaveBeenCalledWith(
      '/tmp/clone/job-test-1',
      'owner/repo:42',
      ['.pr-threads-cache']
    );
    expect(mocks.cloneManager.saveCache).toHaveBeenCalledWith(
      '/tmp/clone/job-test-1',
      'owner/repo:42',
      ['.pr-threads-cache']
    );
  });

  it('should skip cache when not specified', async () => {
    const request = createTestRequest(); // no cache field

    await executor.execute(request);

    expect(mocks.cloneManager.restoreCache).not.toHaveBeenCalled();
    expect(mocks.cloneManager.saveCache).not.toHaveBeenCalled();
  });

  it('should include timing in result', async () => {
    const result = await executor.execute(createTestRequest());

    expect(result.timing.startedAt).toBeDefined();
    expect(result.timing.completedAt).toBeDefined();
    expect(result.timing.durationMs).toBeGreaterThanOrEqual(0);
  });
});
