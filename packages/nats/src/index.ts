export type { NatsConfig } from './connection.js';
export { closeNatsConnection, getNatsConnection } from './connection.js';
export { createNatsPublisher, createNatsSubscriber } from './factory.js';
export type { PublishableEvent } from './publisher.js';
export { NatsPublisher } from './publisher.js';
export type { StreamConfig } from './stream-config.js';
export {
  CLAUDE_JOBS_STREAM_CONFIG,
  CLAUDE_JOBS_STREAM_NAME,
  CLAUDE_JOBS_STREAM_SUBJECTS,
  GITHUB_EVENTS_STREAM_CONFIG,
  STREAM_CONFIG,
  STREAM_NAME,
  STREAM_SUBJECTS,
} from './stream-config.js';
export type { SubscriberConfig } from './subscriber.js';
export { NatsSubscriber } from './subscriber.js';
