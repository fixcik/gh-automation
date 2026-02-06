import { nanos } from '@nats-io/nats-core/internal';

export const STREAM_NAME = 'GITHUB_EVENTS';

export const STREAM_SUBJECTS = ['github.notification.>'];

export const STREAM_CONFIG = {
  name: STREAM_NAME,
  subjects: STREAM_SUBJECTS,
  max_age: nanos(7 * 24 * 60 * 60 * 1_000), // 7 days in milliseconds
  max_msgs: 100_000,
  storage: 'file' as const,
  num_replicas: 1,
};
