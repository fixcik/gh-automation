import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeRunner } from '../claude-runner.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
});

describe('ClaudeRunner', () => {
  let runner: ClaudeRunner;
  let logger: ReturnType<typeof createMockLogger>;
  let mockExeca: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    logger = createMockLogger();
    runner = new ClaudeRunner(logger as any);
    const execaMod = await import('execa');
    mockExeca = execaMod.execa as unknown as ReturnType<typeof vi.fn>;
    mockExeca.mockReset();
  });

  it('should call execa with correct arguments', async () => {
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: '{"result": "done"}',
      stderr: '',
    });

    await runner.run('Fix the bug', '/tmp/clone', ['-p', '--model', 'sonnet'], 300_000);

    expect(mockExeca).toHaveBeenCalledWith(
      'claude',
      ['-p', '--model', 'sonnet'],
      expect.objectContaining({
        cwd: '/tmp/clone',
        input: 'Fix the bug',
        timeout: 300_000,
        reject: false,
      })
    );
  });

  it('should return ClaudeResult with exit code, stdout, stderr', async () => {
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: 'output text',
      stderr: 'some warnings',
    });

    const result = await runner.run('prompt', '/tmp/clone', ['-p']);

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'output text',
      stderr: 'some warnings',
    });
  });

  it('should handle non-zero exit code without throwing', async () => {
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'Error occurred',
    });

    const result = await runner.run('prompt', '/tmp/clone', ['-p']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Error occurred');
  });

  it('should handle timeout gracefully', async () => {
    mockExeca.mockRejectedValue(new Error('timed out after 5000 milliseconds'));

    const result = await runner.run('prompt', '/tmp/clone', ['-p'], 5000);

    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('timed out');
  });

  it('should re-throw non-timeout errors', async () => {
    mockExeca.mockRejectedValue(new Error('ENOENT: claude not found'));

    await expect(runner.run('prompt', '/tmp/clone', ['-p'])).rejects.toThrow(
      'ENOENT: claude not found'
    );
  });
});
