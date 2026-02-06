import type { Logger } from '@gh-automation/logger';
import { execa } from 'execa';

export interface ClaudeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class ClaudeRunner {
  constructor(private readonly logger: Logger) {}

  /**
   * Runs `claude` CLI with given arguments in the specified directory.
   *
   * @param prompt - The prompt text to send via stdin
   * @param cwd - Working directory (clone path)
   * @param args - CLI arguments (from ClaudeConfigBuilder.buildArgs)
   * @param timeoutMs - Max execution time (default: 10 minutes)
   * @returns ClaudeResult with exit code, stdout, stderr
   */
  async run(
    prompt: string,
    cwd: string,
    args: string[],
    timeoutMs = 600_000
  ): Promise<ClaudeResult> {
    this.logger.info({ cwd, argsCount: args.length, timeoutMs }, 'Starting Claude CLI');

    try {
      const result = await execa('claude', args, {
        cwd,
        input: prompt,
        timeout: timeoutMs,
        reject: false, // Don't throw on non-zero exit code
      });

      this.logger.info(
        { exitCode: result.exitCode, stdoutLength: result.stdout.length },
        'Claude CLI finished'
      );

      return {
        exitCode: result.exitCode ?? 1, // Default to 1 if undefined
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      // Timeout or other system error (not Claude exit code)
      if (error instanceof Error && error.message.includes('timed out')) {
        this.logger.error({ timeoutMs }, 'Claude CLI timed out');
        return {
          exitCode: -1,
          stdout: '',
          stderr: `Process timed out after ${timeoutMs}ms`,
        };
      }
      throw error;
    }
  }
}
