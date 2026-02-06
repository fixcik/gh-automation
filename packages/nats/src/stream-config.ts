import { nanos } from '@nats-io/nats-core/internal';

// --- Stream config type ---

export interface StreamConfig {
  name: string;
  subjects: string[];
  max_age: number;
  max_msgs: number;
  storage: 'file' | 'memory';
  num_replicas: number;
}

// --- GITHUB_EVENTS (default, backward-compatible) ---

export const STREAM_NAME = 'GITHUB_EVENTS';
export const STREAM_SUBJECTS = ['github.notification.>'];

export const STREAM_CONFIG: StreamConfig = {
  name: STREAM_NAME,
  subjects: STREAM_SUBJECTS,
  max_age: nanos(7 * 24 * 60 * 60 * 1_000), // 7 days in milliseconds
  max_msgs: 100_000,
  storage: 'file',
  num_replicas: 1,
};

// Alias for explicit usage
export const GITHUB_EVENTS_STREAM_CONFIG = STREAM_CONFIG;

// --- CLAUDE_JOBS ---

export const CLAUDE_JOBS_STREAM_NAME = 'CLAUDE_JOBS';
export const CLAUDE_JOBS_STREAM_SUBJECTS = ['claude.job.>'];

export const CLAUDE_JOBS_STREAM_CONFIG: StreamConfig = {
  name: CLAUDE_JOBS_STREAM_NAME,
  subjects: CLAUDE_JOBS_STREAM_SUBJECTS,
  max_age: nanos(7 * 24 * 60 * 60 * 1_000), // 7 days in milliseconds
  max_msgs: 100_000,
  storage: 'file',
  num_replicas: 1,
};
