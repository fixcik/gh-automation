import type { Logger } from '@gh-automation/logger';
import type { JetStreamClient, JetStreamManager } from '@nats-io/jetstream';
import { STREAM_CONFIG, STREAM_NAME } from './stream-config.js';

export interface PublishableEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
}

export class NatsPublisher {
  private streamEnsured = false;

  constructor(
    private readonly js: JetStreamClient,
    private readonly jsm: JetStreamManager,
    private readonly logger: Logger
  ) {}

  async ensureStream(): Promise<void> {
    if (this.streamEnsured) return;

    try {
      await this.jsm.streams.info(STREAM_NAME);
      this.logger.info({ stream: STREAM_NAME }, 'Stream already exists');
    } catch (err) {
      const isNotFound =
        err instanceof Error &&
        (err.message.includes('stream not found') || err.message.includes('not found'));
      if (!isNotFound) {
        throw err;
      }
      this.logger.info({ stream: STREAM_NAME }, 'Creating stream');
      await this.jsm.streams.add(STREAM_CONFIG);
      this.logger.info({ stream: STREAM_NAME }, 'Stream created');
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
