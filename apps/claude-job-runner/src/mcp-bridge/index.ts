import type { ToolDefinition } from '@gh-automation/shared-types';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { connect } from '@nats-io/transport-node';
import { NatsToolProxy } from './nats-tool-proxy.js';

async function main() {
  const jobId = process.env.JOB_ID;
  const natsUrl = process.env.NATS_URL;
  const toolDefsRaw = process.env.TOOL_DEFINITIONS;

  if (!jobId || !natsUrl || !toolDefsRaw) {
    console.error('Missing required env: JOB_ID, NATS_URL, TOOL_DEFINITIONS');
    process.exit(1);
  }

  let tools: ToolDefinition[];
  try {
    tools = JSON.parse(toolDefsRaw);
  } catch (error) {
    console.error('Failed to parse TOOL_DEFINITIONS:', error);
    console.error('Raw value:', toolDefsRaw.substring(0, 200));
    process.exit(1);
  }

  const nc = await connect({ servers: natsUrl });
  const proxy = new NatsToolProxy(nc, jobId);

  // Using v1 Server (deprecated but stable until v2 is published to npm)
  const server = new Server(
    { name: 'job-bridge', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: proxy.buildToolList(tools),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolDef = tools.find((t) => t.name === name);

    // Block unknown tools
    if (!toolDef) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      } as unknown as Record<string, unknown>;
    }

    const timeoutMs = toolDef.timeoutMs ?? 30_000;

    const result = await proxy.callTool(name, (args ?? {}) as Record<string, unknown>, timeoutMs);
    // v1 ServerResult requires index signature - wire protocol compatible
    return result as unknown as Record<string, unknown>;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`MCP bridge started for job ${jobId}`);

  const cleanup = async () => {
    await server.close();
    await proxy.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

main().catch((error) => {
  console.error('MCP bridge failed:', error);
  process.exit(1);
});
