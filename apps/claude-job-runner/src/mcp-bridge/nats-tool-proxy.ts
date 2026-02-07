import type { ToolDefinition } from '@gh-automation/shared-types';
import type { NatsConnection } from '@nats-io/transport-node';

export interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpToolListItem {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class NatsToolProxy {
  constructor(
    private readonly nc: NatsConnection,
    private readonly jobId: string
  ) {}

  /**
   * Builds the NATS subject for a tool call.
   */
  getSubject(toolName: string): string {
    return `claude.job.tool.${this.jobId}.${toolName}`;
  }

  /**
   * Builds MCP tools/list response from ToolDefinitions.
   * Strips `timeoutMs` since it's not part of MCP protocol.
   */
  buildToolList(tools: ToolDefinition[]): McpToolListItem[] {
    return tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  /**
   * Calls a tool by publishing a NATS request and waiting for a response.
   * Returns MCP CallToolResult format.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs = 30_000
  ): Promise<CallToolResult> {
    const subject = this.getSubject(toolName);
    const payload = JSON.stringify(args);

    try {
      const response = await this.nc.request(subject, Buffer.from(payload), {
        timeout: timeoutMs,
      });

      const data = JSON.parse(new TextDecoder().decode(response.data));

      if (data.error) {
        return {
          content: [{ type: 'text', text: `Error: ${data.error}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: typeof data.result === 'string' ? data.result : JSON.stringify(data.result),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('TIMEOUT') || message.includes('timeout')) {
        return {
          content: [{ type: 'text', text: `Tool "${toolName}" timed out after ${timeoutMs}ms` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: `Tool "${toolName}" failed: ${message}` }],
        isError: true,
      };
    }
  }

  /**
   * Gracefully shuts down the NATS connection.
   */
  async shutdown(): Promise<void> {
    await this.nc.drain();
  }
}
