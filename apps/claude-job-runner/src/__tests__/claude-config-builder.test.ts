import type { ToolDefinition } from '@gh-automation/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { ClaudeConfigBuilder } from '../claude-config-builder.js';

const testTool: ToolDefinition = {
  name: 'send_notification',
  description: 'Send a notification',
  inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
};

describe('ClaudeConfigBuilder', () => {
  let builder: ClaudeConfigBuilder;

  beforeEach(() => {
    builder = new ClaudeConfigBuilder();
  });

  describe('buildArgs', () => {
    it('should return base args with empty config', () => {
      const args = builder.buildArgs({});
      expect(args).toEqual(['-p', '--output-format', 'json']);
    });

    it('should include --model when specified', () => {
      const args = builder.buildArgs({ model: 'sonnet' });
      expect(args).toContain('--model');
      expect(args).toContain('sonnet');
    });

    it('should include --max-turns when specified', () => {
      const args = builder.buildArgs({ maxTurns: 50 });
      expect(args).toContain('--max-turns');
      expect(args).toContain('50');
    });

    it('should include --max-budget-usd when specified', () => {
      const args = builder.buildArgs({ maxBudgetUsd: 5 });
      expect(args).toContain('--max-budget-usd');
      expect(args).toContain('5');
    });

    it('should include --allowedTools as comma-separated string', () => {
      const args = builder.buildArgs({
        allowedTools: ['Edit', 'Write', 'Bash(git:*)'],
      });
      expect(args).toContain('--allowedTools');
      expect(args).toContain('Edit,Write,Bash(git:*)');
    });

    it('should not include --allowedTools when array is empty', () => {
      const args = builder.buildArgs({ allowedTools: [] });
      expect(args).not.toContain('--allowedTools');
    });

    it('should include --permission-mode when specified', () => {
      const args = builder.buildArgs({ permissionMode: 'bypassPermissions' });
      expect(args).toContain('--permission-mode');
      expect(args).toContain('bypassPermissions');
    });

    it('should combine all options', () => {
      const args = builder.buildArgs({
        model: 'opus',
        maxTurns: 100,
        maxBudgetUsd: 10,
        allowedTools: ['Edit', 'Write'],
        permissionMode: 'bypassPermissions',
      });

      expect(args).toEqual([
        '-p',
        '--output-format',
        'json',
        '--model',
        'opus',
        '--max-turns',
        '100',
        '--max-budget-usd',
        '10',
        '--allowedTools',
        'Edit,Write',
        '--permission-mode',
        'bypassPermissions',
      ]);
    });
  });

  describe('buildMcpConfig', () => {
    it('should throw error when extraServers attempts to override job-bridge', async () => {
      await expect(
        builder.buildMcpConfig({
          jobId: 'test-job',
          tools: [testTool],
          bridgeCommand: 'node',
          bridgeArgs: ['/app/dist/mcp-bridge/index.js'],
          natsUrl: 'nats://localhost',
          extraServers: {
            'job-bridge': {
              command: 'malicious',
            },
          },
          configDir: '/tmp/test',
        })
      ).rejects.toThrow('extraServers cannot override job-bridge');
    });
  });
});
