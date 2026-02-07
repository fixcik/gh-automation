import type { ToolDefinition } from '@gh-automation/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NatsToolProxy } from '../mcp-bridge/nats-tool-proxy.js';

const createMockNatsConnection = () => ({
  request: vi.fn(),
  drain: vi.fn().mockResolvedValue(undefined),
  isClosed: vi.fn().mockReturnValue(false),
});

const testTools: ToolDefinition[] = [
  {
    name: 'send_notification',
    description: 'Send a notification to the user',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
    timeoutMs: 10_000,
  },
  {
    name: 'ask_user',
    description: 'Ask the user a question',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } } },
    timeoutMs: 300_000,
  },
];

describe('NatsToolProxy', () => {
  let proxy: NatsToolProxy;
  let mockNc: ReturnType<typeof createMockNatsConnection>;

  beforeEach(() => {
    mockNc = createMockNatsConnection();
    proxy = new NatsToolProxy(mockNc as any, 'job-123');
  });

  describe('getSubject', () => {
    it('should build correct NATS subject', () => {
      expect(proxy.getSubject('send_notification')).toBe(
        'claude.job.tool.job-123.send_notification'
      );
    });

    it('should handle different tool names', () => {
      expect(proxy.getSubject('ask_user')).toBe('claude.job.tool.job-123.ask_user');
    });
  });

  describe('buildToolList', () => {
    it('should return MCP-compatible tool list without timeoutMs', () => {
      const result = proxy.buildToolList(testTools);

      expect(result).toEqual([
        {
          name: 'send_notification',
          description: 'Send a notification to the user',
          inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
        },
        {
          name: 'ask_user',
          description: 'Ask the user a question',
          inputSchema: { type: 'object', properties: { question: { type: 'string' } } },
        },
      ]);
    });

    it('should return empty array for empty tools', () => {
      expect(proxy.buildToolList([])).toEqual([]);
    });
  });

  describe('callTool', () => {
    it('should send NATS request and return success result', async () => {
      mockNc.request.mockResolvedValue({
        data: new TextEncoder().encode(JSON.stringify({ result: 'Notification sent' })),
      });

      const result = await proxy.callTool('send_notification', { message: 'Hello' });

      expect(mockNc.request).toHaveBeenCalledWith(
        'claude.job.tool.job-123.send_notification',
        expect.any(Buffer),
        { timeout: 30_000 }
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: 'Notification sent' }],
      });
    });

    it('should return structured result as JSON string', async () => {
      mockNc.request.mockResolvedValue({
        data: new TextEncoder().encode(JSON.stringify({ result: { id: 1, status: 'ok' } })),
      });

      const result = await proxy.callTool('send_notification', { message: 'Hello' });

      expect(result.content[0].text).toBe('{"id":1,"status":"ok"}');
    });

    it('should return error when response contains error field', async () => {
      mockNc.request.mockResolvedValue({
        data: new TextEncoder().encode(JSON.stringify({ error: 'Not found' })),
      });

      const result = await proxy.callTool('send_notification', { message: 'Hello' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: Not found');
    });

    it('should handle NATS timeout', async () => {
      mockNc.request.mockRejectedValue(new Error('TIMEOUT'));

      const result = await proxy.callTool('send_notification', { message: 'Hello' }, 5_000);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('timed out after 5000ms');
    });

    it('should handle connection errors', async () => {
      mockNc.request.mockRejectedValue(new Error('Connection refused'));

      const result = await proxy.callTool('send_notification', { message: 'Hello' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('failed: Connection refused');
    });

    it('should use custom timeout', async () => {
      mockNc.request.mockResolvedValue({
        data: new TextEncoder().encode(JSON.stringify({ result: 'ok' })),
      });

      await proxy.callTool('ask_user', { question: 'Approve?' }, 300_000);

      expect(mockNc.request).toHaveBeenCalledWith(
        'claude.job.tool.job-123.ask_user',
        expect.any(Buffer),
        { timeout: 300_000 }
      );
    });
  });

  describe('shutdown', () => {
    it('should drain NATS connection', async () => {
      await proxy.shutdown();

      expect(mockNc.drain).toHaveBeenCalled();
    });
  });
});
