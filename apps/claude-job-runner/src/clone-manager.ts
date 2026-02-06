import { access, cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@gh-automation/logger';
import type { ClaudeJobRequest } from '@gh-automation/shared-types';
import { execa } from 'execa';

export class CloneManager {
  constructor(
    private readonly baseDir: string,
    private readonly cacheBaseDir: string,
    private readonly logger: Logger
  ) {}

  /**
   * Builds the clone directory path for a job.
   */
  getClonePath(jobId: string): string {
    return join(this.baseDir, `job-${jobId}`);
  }

  /**
   * Builds git clone CLI arguments from repository config.
   */
  buildCloneArgs(repo: ClaudeJobRequest['repository'], destPath: string): string[] {
    const args = ['clone'];

    if (repo.branch) {
      args.push('--branch', repo.branch);
    }

    if (repo.cloneDepth && repo.cloneDepth > 0) {
      args.push('--depth', String(repo.cloneDepth));
    }

    args.push(repo.url, destPath);
    return args;
  }

  /**
   * Clones the repository into a job-specific directory.
   * Returns the path to the cloned repo.
   */
  async clone(jobId: string, repo: ClaudeJobRequest['repository']): Promise<string> {
    const clonePath = this.getClonePath(jobId);

    await mkdir(clonePath, { recursive: true });

    const args = this.buildCloneArgs(repo, clonePath);

    this.logger.info({ jobId, url: repo.url, branch: repo.branch }, 'Cloning repository');

    await execa('git', args, { timeout: 120_000 });

    this.logger.info({ jobId, clonePath }, 'Repository cloned');
    return clonePath;
  }

  /**
   * Removes the clone directory.
   */
  async cleanup(clonePath: string): Promise<void> {
    try {
      await rm(clonePath, { recursive: true, force: true });
      this.logger.debug({ clonePath }, 'Clone directory cleaned up');
    } catch (error) {
      this.logger.warn({ clonePath, error }, 'Failed to cleanup clone directory');
    }
  }

  /**
   * Builds the cache key path for a job.
   * Cache is keyed by aggregateId (e.g. "owner/repo:42") to persist across job runs.
   */
  getCachePath(aggregateId: string): string {
    // Sanitize aggregateId for filesystem: replace / and : with _
    const sanitized = aggregateId.replace(/[/:]/g, '_');
    return join(this.cacheBaseDir, sanitized);
  }

  /**
   * Restores cached paths from cache directory into the clone.
   */
  async restoreCache(clonePath: string, aggregateId: string, cachePaths: string[]): Promise<void> {
    const cacheSrcDir = this.getCachePath(aggregateId);

    for (const relativePath of cachePaths) {
      const src = join(cacheSrcDir, relativePath);
      const dest = join(clonePath, relativePath);

      try {
        await access(src);
        await mkdir(join(dest, '..'), { recursive: true });
        await cp(src, dest, { recursive: true });
        this.logger.debug({ src, dest }, 'Cache restored');
      } catch {
        this.logger.debug({ src }, 'Cache path not found, skipping');
      }
    }
  }

  /**
   * Saves cached paths from clone to cache directory for future runs.
   */
  async saveCache(clonePath: string, aggregateId: string, cachePaths: string[]): Promise<void> {
    const cacheDestDir = this.getCachePath(aggregateId);

    for (const relativePath of cachePaths) {
      const src = join(clonePath, relativePath);
      const dest = join(cacheDestDir, relativePath);

      try {
        await access(src);
        await mkdir(join(dest, '..'), { recursive: true });
        await cp(src, dest, { recursive: true });
        this.logger.debug({ src, dest }, 'Cache saved');
      } catch {
        this.logger.debug({ src }, 'Cache source not found, skipping');
      }
    }
  }
}
