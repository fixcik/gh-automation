import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloneManager } from '../clone-manager.js';

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
});

describe('CloneManager', () => {
  let manager: CloneManager;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    manager = new CloneManager('/tmp/clone', logger as any);
  });

  describe('getClonePath', () => {
    it('should build correct clone path from valid jobId', () => {
      expect(manager.getClonePath('abc-123')).toBe('/tmp/clone/job-abc-123');
    });

    it('should accept UUID format jobIds', () => {
      expect(manager.getClonePath('550e8400-e29b-41d4-a716-446655440000')).toBe(
        '/tmp/clone/job-550e8400-e29b-41d4-a716-446655440000'
      );
    });

    it('should reject jobId with path traversal attempts', () => {
      expect(() => manager.getClonePath('../etc/passwd')).toThrow('Invalid jobId format');
      expect(() => manager.getClonePath('../../root')).toThrow('Invalid jobId format');
      expect(() => manager.getClonePath('job/../etc')).toThrow('Invalid jobId format');
    });

    it('should reject jobId with special characters', () => {
      expect(() => manager.getClonePath('job@123')).toThrow('Invalid jobId format');
      expect(() => manager.getClonePath('job$test')).toThrow('Invalid jobId format');
      expect(() => manager.getClonePath('job/123')).toThrow('Invalid jobId format');
    });
  });

  describe('buildCloneArgs', () => {
    it('should build basic clone args with url only', () => {
      const args = manager.buildCloneArgs(
        { url: 'https://github.com/owner/repo.git' },
        '/tmp/clone/job-1'
      );
      expect(args).toEqual(['clone', 'https://github.com/owner/repo.git', '/tmp/clone/job-1']);
    });

    it('should include --branch when specified', () => {
      const args = manager.buildCloneArgs(
        { url: 'https://github.com/owner/repo.git', branch: 'feature/test' },
        '/tmp/clone/job-1'
      );
      expect(args).toEqual([
        'clone',
        '--branch',
        'feature/test',
        'https://github.com/owner/repo.git',
        '/tmp/clone/job-1',
      ]);
    });

    it('should include --depth when specified and > 0', () => {
      const args = manager.buildCloneArgs(
        { url: 'https://github.com/owner/repo.git', cloneDepth: 1 },
        '/tmp/clone/job-1'
      );
      expect(args).toEqual([
        'clone',
        '--depth',
        '1',
        'https://github.com/owner/repo.git',
        '/tmp/clone/job-1',
      ]);
    });

    it('should not include --depth when 0', () => {
      const args = manager.buildCloneArgs(
        { url: 'https://github.com/owner/repo.git', cloneDepth: 0 },
        '/tmp/clone/job-1'
      );
      expect(args).toEqual(['clone', 'https://github.com/owner/repo.git', '/tmp/clone/job-1']);
    });

    it('should combine branch and depth', () => {
      const args = manager.buildCloneArgs(
        { url: 'https://github.com/owner/repo.git', branch: 'main', cloneDepth: 10 },
        '/tmp/clone/job-1'
      );
      expect(args).toEqual([
        'clone',
        '--branch',
        'main',
        '--depth',
        '10',
        'https://github.com/owner/repo.git',
        '/tmp/clone/job-1',
      ]);
    });
  });
});
