import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServerConfig, ToolDefinition } from '@gh-automation/shared-types';

export class ClaudeConfigBuilder {
  /**
   * Builds CLI arguments for `claude -p` from job request config.
   */
  buildArgs(config: {
    model?: string;
    maxTurns?: number;
    maxBudgetUsd?: number;
    allowedTools?: string[];
    permissionMode?: string;
  }): string[] {
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
   * Includes the job-bridge MCP server (generic NATS tool proxy)
   * plus any extra MCP servers from the job request.
   *
   * Returns the path to the generated config file.
   */
  async buildMcpConfig(options: {
    jobId: string;
    tools: ToolDefinition[];
    bridgeCommand: string;
    bridgeArgs?: string[];
    natsUrl: string;
    extraServers?: Record<string, McpServerConfig>;
    configDir: string;
  }): Promise<string> {
    const { jobId, tools, bridgeCommand, bridgeArgs, natsUrl, extraServers, configDir } = options;

    const mcpConfig: Record<string, McpServerConfig> = {};

    // Add job-bridge MCP server (generic NATS tool proxy)
    mcpConfig['job-bridge'] = {
      command: bridgeCommand,
      args: bridgeArgs,
      env: {
        NATS_URL: natsUrl,
        JOB_ID: jobId,
        TOOL_DEFINITIONS: JSON.stringify(tools),
      },
    };

    // Add extra MCP servers from job request
    if (extraServers) {
      for (const [name, config] of Object.entries(extraServers)) {
        if (name === 'job-bridge') {
          throw new Error('extraServers cannot override job-bridge');
        }
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
