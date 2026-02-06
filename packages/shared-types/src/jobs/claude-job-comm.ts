import type { JobType } from './job-type.enum.js';

export type ClaudeJobCommType = 'notification' | 'question' | 'answer' | 'progress';

export interface ClaudeJobComm {
  jobId: string;
  jobType: JobType;
  type: ClaudeJobCommType;
  content: string;
  level?: 'info' | 'warn' | 'error';
  questionId?: string;
  createdAt: string;
}
