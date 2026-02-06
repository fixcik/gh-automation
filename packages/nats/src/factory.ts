import type { Logger } from '@gh-automation/logger';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';
import { NatsPublisher } from './publisher.js';
import type { StreamConfig } from './stream-config.js';
import { NatsSubscriber } from './subscriber.js';

export async function createNatsPublisher(
  nc: NatsConnection,
  logger: Logger,
  streamConfig: StreamConfig
): Promise<NatsPublisher> {
  const js = jetstream(nc);
  const jsm = await jetstreamManager(nc);
  const publisher = new NatsPublisher(js, jsm, logger, streamConfig);
  await publisher.ensureStream();
  return publisher;
}

export async function createNatsSubscriber(
  nc: NatsConnection,
  logger: Logger,
  streamName: string
): Promise<NatsSubscriber> {
  const js = jetstream(nc);
  const jsm = await jetstreamManager(nc);
  return new NatsSubscriber(js, jsm, logger, streamName);
}
