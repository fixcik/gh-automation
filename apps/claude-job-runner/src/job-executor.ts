import type { Logger } from '@gh-automation/logger';
import type { NatsPublisher, PublishableEvent } from '@gh-automation/nats';
import type { ClaudeJobRequest, ClaudeJobResult } from '@gh-automation/shared-types';
import type { ClaudeConfigBuilder } from './claude-config-builder.js';
import type { ClaudeResult, ClaudeRunner } from './claude-runner.js';
import type { CloneManager } from './clone-manager.js';

export interface JobExecutorDeps {
  cloneManager: CloneManager;
  claudeRunner: ClaudeRunner;
  configBuilder: ClaudeConfigBuilder;
  publisher: NatsPublisher;
  logger: Logger;
  natsUrl: string;
}

export class JobExecutor {
  private readonly cloneManager: CloneManager;
  private readonly claudeRunner: ClaudeRunner;
  private readonly configBuilder: ClaudeConfigBuilder;
  private readonly publisher: NatsPublisher;
  private readonly logger: Logger;
  private readonly natsUrl: string;

  constructor(deps: JobExecutorDeps) {
    this.cloneManager = deps.cloneManager;
    this.claudeRunner = deps.claudeRunner;
    this.configBuilder = deps.configBuilder;
    this.publisher = deps.publisher;
    this.logger = deps.logger;
    this.natsUrl = deps.natsUrl;
  }

  private getAggregateId(metadata: ClaudeJobRequest['metadata']): string {
    return `${metadata.repository}:${metadata.prNumber}`;
  }

  /**
   * Executes a complete job pipeline:
   * 1. Clone repo
   * 2. Restore cache
   * 3. Build Claude CLI args + MCP config
   * 4. Run Claude
   * 5. Save cache
   * 6. Publish result to NATS
   * 7. Cleanup clone (always)
   */
  async execute(request: ClaudeJobRequest): Promise<ClaudeJobResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    let clonePath: string | null = null;

    try {
      // 1. Clone
      clonePath = await this.cloneManager.clone(request.jobId, request.repository);

      // 2. Restore cache
      if (request.cache?.paths?.length) {
        const aggregateId = this.getAggregateId(request.metadata);
        await this.cloneManager.restoreCache(clonePath, aggregateId, request.cache.paths);
      }

      // 3. Build config
      const args = this.configBuilder.buildArgs(request.claude);

      if (request.communication.enableNotifications || request.communication.enableAskUser) {
        await this.configBuilder.buildMcpConfig({
          jobId: request.jobId,
          jobType: request.jobType,
          commMcpCommand: 'node',
          commMcpArgs: ['/app/apps/claude-job-runner/dist/mcp-server/index.js'],
          natsUrl: this.natsUrl,
          extraServers: request.claude.mcpServers,
          configDir: clonePath,
        });
      }

      // 4. Run Claude
      const timeoutMs = request.claude.timeoutMs ?? 600_000;
      const claudeResult = await this.claudeRunner.run(request.prompt, clonePath, args, timeoutMs);

      // 5. Save cache
      if (request.cache?.paths?.length && clonePath) {
        const aggregateId = this.getAggregateId(request.metadata);
        await this.cloneManager.saveCache(clonePath, aggregateId, request.cache.paths);
      }

      // 6. Build result
      const result = this.buildResult(request, claudeResult, startedAt, startTime);

      // 7. Publish result
      await this.publishResult(request, result);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const errorResult = this.buildErrorResult(request, err, startedAt, startTime);

      await this.publishResult(request, errorResult);

      return errorResult;
    } finally {
      // 8. Cleanup
      if (clonePath) {
        await this.cloneManager.cleanup(clonePath);
      }
    }
  }

  private buildResult(
    request: ClaudeJobRequest,
    claudeResult: ClaudeResult,
    startedAt: string,
    startTime: number
  ): ClaudeJobResult {
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    if (claudeResult.exitCode === -1) {
      return {
        jobId: request.jobId,
        jobType: request.jobType,
        status: 'timeout',
        error: { message: claudeResult.stderr, exitCode: -1 },
        timing: { startedAt, completedAt, durationMs },
        metadata: request.metadata,
      };
    }

    if (claudeResult.exitCode !== 0) {
      return {
        jobId: request.jobId,
        jobType: request.jobType,
        status: 'failed',
        error: {
          message: claudeResult.stderr || 'Claude exited with non-zero code',
          exitCode: claudeResult.exitCode,
        },
        timing: { startedAt, completedAt, durationMs },
        metadata: request.metadata,
      };
    }

    return {
      jobId: request.jobId,
      jobType: request.jobType,
      status: 'completed',
      result: {
        summary: this.extractSummary(claudeResult.stdout),
        output: claudeResult.stdout,
        exitCode: 0,
      },
      timing: { startedAt, completedAt, durationMs },
      metadata: request.metadata,
    };
  }

  private buildErrorResult(
    request: ClaudeJobRequest,
    error: Error,
    startedAt: string,
    startTime: number
  ): ClaudeJobResult {
    return {
      jobId: request.jobId,
      jobType: request.jobType,
      status: 'failed',
      error: { message: error.message },
      timing: {
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
      metadata: request.metadata,
    };
  }

  private extractSummary(stdout: string): string {
    // Try to parse JSON output from Claude
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.result) return String(parsed.result).slice(0, 500);
    } catch {
      // Not JSON, use raw output
    }
    return stdout.slice(0, 500);
  }

  private async publishResult(request: ClaudeJobRequest, result: ClaudeJobResult): Promise<void> {
    const event: PublishableEvent = {
      eventId: `result-${request.jobId}`,
      eventType: `claude.job.result.${request.jobType}`,
      aggregateId: request.jobId,
      payload: result,
      metadata: {
        jobType: request.jobType,
        status: result.status,
      },
    };

    try {
      await this.publisher.publish(event);
      this.logger.info({ jobId: request.jobId, status: result.status }, 'Job result published');
    } catch (error) {
      this.logger.error({ jobId: request.jobId, error }, 'Failed to publish job result');
    }
  }
}
