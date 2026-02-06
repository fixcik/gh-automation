import type { Logger } from '@gh-automation/logger';
import type { JetStreamClient, JetStreamManager } from '@nats-io/jetstream';
import { STREAM_CONFIG, type StreamConfig } from './stream-config.js';

export interface PublishableEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
}

export class NatsPublisher {
  private streamEnsured = false;
  private readonly streamConfig: StreamConfig;

  constructor(
    private readonly js: JetStreamClient,
    private readonly jsm: JetStreamManager,
    private readonly logger: Logger,
    streamConfig?: StreamConfig
  ) {
    this.streamConfig = streamConfig ?? STREAM_CONFIG;
  }

  async ensureStream(): Promise<void> {
    if (this.streamEnsured) return;

    try {
      await this.jsm.streams.info(this.streamConfig.name);
      this.logger.info({ stream: this.streamConfig.name }, 'Stream already exists');
    } catch (err) {
      const isNotFound =
        err instanceof Error &&
        (err.message.includes('stream not found') || err.message.includes('not found'));
      if (!isNotFound) {
        throw err;
      }
      this.logger.info({ stream: this.streamConfig.name }, 'Creating stream');
      await this.jsm.streams.add(this.streamConfig);
      this.logger.info({ stream: this.streamConfig.name }, 'Stream created');
    }

    this.streamEnsured = true;
  }

  async publish(event: PublishableEvent): Promise<void> {
    const subject = event.eventType;
    const data = JSON.stringify(event);

    const ack = await this.js.publish(subject, data, {
      msgID: event.eventId,
    });

    this.logger.debug(
      {
        eventId: event.eventId,
        subject,
        stream: ack.stream,
        seq: ack.seq,
        duplicate: ack.duplicate,
      },
      'Event published to NATS'
    );
  }
}
