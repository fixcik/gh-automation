import type { JobType } from './job-type.enum.js';

export interface ClaudeJobResult {
  jobId: string;
  jobType: JobType;
  status: 'completed' | 'failed' | 'timeout';
  result?: {
    summary: string;
    output: string;
    exitCode: number;
  };
  error?: {
    message: string;
    exitCode?: number;
  };
  timing: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  metadata: Record<string, unknown>;
}
