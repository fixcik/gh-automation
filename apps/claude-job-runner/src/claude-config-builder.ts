import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeJobRequest, McpServerConfig } from '@gh-automation/shared-types';

export class ClaudeConfigBuilder {
  /**
   * Builds CLI arguments for `claude -p` from job request config.
   */
  buildArgs(config: ClaudeJobRequest['claude']): string[] {
    const args: string[] = ['-p', '--output-format', 'json'];

    if (config.model) {
      args.push('--model', config.model);
    }

    if (config.maxTurns) {
      args.push('--max-turns', String(config.maxTurns));
    }

    if (config.maxBudgetUsd) {
      args.push('--max-budget-usd', String(config.maxBudgetUsd));
    }

    if (config.allowedTools && config.allowedTools.length > 0) {
      args.push('--allowedTools', config.allowedTools.join(','));
    }

    if (config.permissionMode) {
      args.push('--permission-mode', config.permissionMode);
    }

    return args;
  }

  /**
   * Generates a temporary MCP config JSON file for the Claude session.
   * Includes the job-comm MCP server (for send_notification, ask_user, etc.)
   * plus any extra MCP servers from the job request.
   *
   * Returns the path to the generated config file.
   */
  async buildMcpConfig(options: {
    jobId: string;
    jobType: string;
    commMcpCommand: string;
    commMcpArgs?: string[];
    natsUrl: string;
    extraServers?: Record<string, McpServerConfig>;
    configDir: string;
  }): Promise<string> {
    const { jobId, jobType, commMcpCommand, commMcpArgs, natsUrl, extraServers, configDir } =
      options;

    const mcpConfig: Record<string, McpServerConfig> = {};

    // Add comm MCP server (notification, ask_user, progress)
    mcpConfig['job-comm'] = {
      command: commMcpCommand,
      args: commMcpArgs,
      env: {
        NATS_URL: natsUrl,
        JOB_ID: jobId,
        JOB_TYPE: jobType,
      },
    };

    // Add extra MCP servers from job request
    if (extraServers) {
      for (const [name, config] of Object.entries(extraServers)) {
        mcpConfig[name] = config;
      }
    }

    const configContent = JSON.stringify({ mcpServers: mcpConfig }, null, 2);
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, '.mcp.json');
    await writeFile(configPath, configContent, 'utf-8');

    return configPath;
  }
}
