import type { Logger } from '@gh-automation/logger';
import type { NatsSubscriber } from '@gh-automation/nats';
import type { ClaudeJobRequest } from '@gh-automation/shared-types';
import type { ConsumerMessages, JsMsg } from '@nats-io/jetstream';

export interface ConsumerConfig {
  consumerName: string;
  ackWaitMs: number;
  filterSubject: string;
  heartbeatIntervalMs?: number; // default: 30_000
}

export type JobHandler = (request: ClaudeJobRequest) => Promise<void>;

export class JobConsumer {
  private messages: ConsumerMessages | null = null;
  private stopped = false;

  constructor(
    private readonly subscriber: NatsSubscriber,
    private readonly logger: Logger,
    private readonly config: ConsumerConfig
  ) {}

  /**
   * Ensures the durable consumer exists on the NATS stream.
   */
  async init(): Promise<void> {
    await this.subscriber.ensureConsumer(this.config.consumerName, {
      ackWaitMs: this.config.ackWaitMs,
      filterSubject: this.config.filterSubject,
    });

    this.logger.info(
      { consumer: this.config.consumerName, filter: this.config.filterSubject },
      'Consumer initialized'
    );
  }

  /**
   * Parses a NATS message into a ClaudeJobRequest.
   * Returns null if parsing fails.
   */
  parseMessage(msg: JsMsg): ClaudeJobRequest | null {
    try {
      const raw = JSON.parse(msg.string());
      // The message is a PublishableEvent, the actual request is in payload
      const request = raw.payload as ClaudeJobRequest;
      if (!request.jobId || !request.jobType || !request.prompt) {
        this.logger.warn({ subject: msg.subject }, 'Invalid job request: missing required fields');
        return null;
      }
      return request;
    } catch (error) {
      this.logger.error({ error, subject: msg.subject }, 'Failed to parse job request message');
      return null;
    }
  }

  /**
   * Starts the consumer loop. Processes messages one at a time.
   * Uses msg.working() heartbeat to prevent ack timeout during long Claude runs.
   */
  async listen(handler: JobHandler): Promise<void> {
    const consumer = await this.subscriber.getConsumer(this.config.consumerName);
    this.messages = await consumer.consume();

    this.logger.info({ consumer: this.config.consumerName }, 'Consumer listening for jobs');

    for await (const msg of this.messages) {
      if (this.stopped) break;

      const request = this.parseMessage(msg);
      if (!request) {
        msg.ack();
        continue;
      }

      // Start heartbeat to keep message alive during long processing
      const heartbeatMs = this.config.heartbeatIntervalMs ?? 30_000;
      const heartbeat = setInterval(() => {
        try {
          msg.working();
        } catch {
          // Ignore errors (message might be already acked)
        }
      }, heartbeatMs);

      try {
        this.logger.info(
          { jobId: request.jobId, jobType: request.jobType },
          'Processing job request'
        );

        await handler(request);
        msg.ack();

        this.logger.info({ jobId: request.jobId }, 'Job request acknowledged');
      } catch (error) {
        this.logger.error({ jobId: request.jobId, error }, 'Job processing failed');
        msg.nak();
      } finally {
        clearInterval(heartbeat);
      }
    }
  }

  /**
   * Stops the consumer loop gracefully.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.messages) {
      await this.messages.close();
      this.messages = null;
    }
    this.logger.info('Consumer stopped');
  }
}
