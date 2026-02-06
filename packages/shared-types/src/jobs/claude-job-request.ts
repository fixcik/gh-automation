import type { JobType } from './job-type.enum.js';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ClaudeJobRequest {
  jobId: string;
  jobType: JobType;
  prompt: string;
  repository: {
    url: string;
    branch?: string;
    cloneDepth?: number;
  };
  claude: {
    model?: string;
    maxTurns?: number;
    maxBudgetUsd?: number;
    timeoutMs?: number;
    allowedTools?: string[];
    permissionMode?: string;
    mcpServers?: Record<string, McpServerConfig>;
  };
  communication: {
    enableNotifications: boolean;
    enableAskUser: boolean;
    askUserTimeoutMs?: number;
  };
  cache?: {
    paths: string[];
  };
  metadata: Record<string, unknown>;
  createdAt: string;
}
