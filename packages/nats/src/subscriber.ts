import type { Logger } from '@gh-automation/logger';
import {
  AckPolicy,
  type Consumer,
  type ConsumerConfig,
  DeliverPolicy,
  type JetStreamClient,
  type JetStreamManager,
} from '@nats-io/jetstream';
export interface SubscriberConfig {
  maxAckPending?: number;
  ackWaitMs?: number;
  filterSubject?: string;
}

const DEFAULT_CONFIG: Required<SubscriberConfig> = {
  maxAckPending: 1000,
  ackWaitMs: 30_000,
  filterSubject: '',
};

export class NatsSubscriber {
  constructor(
    private readonly js: JetStreamClient,
    private readonly jsm: JetStreamManager,
    private readonly logger: Logger,
    private readonly streamName: string
  ) {}

  async ensureConsumer(consumerName: string, config?: SubscriberConfig): Promise<void> {
    const opts = { ...DEFAULT_CONFIG, ...config };

    try {
      await this.jsm.consumers.info(this.streamName, consumerName);
      this.logger.info({ consumer: consumerName }, 'Consumer already exists');
    } catch (err) {
      const isNotFound =
        err instanceof Error &&
        (err.message.includes('consumer not found') || err.message.includes('not found'));
      if (!isNotFound) {
        throw err;
      }

      this.logger.info({ consumer: consumerName }, 'Creating durable consumer');

      const consumerConfig: Partial<ConsumerConfig> = {
        durable_name: consumerName,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        max_ack_pending: opts.maxAckPending,
        ack_wait: opts.ackWaitMs * 1_000_000, // ms → ns
      };

      if (opts.filterSubject) {
        consumerConfig.filter_subject = opts.filterSubject;
      }

      await this.jsm.consumers.add(this.streamName, consumerConfig);
      this.logger.info({ consumer: consumerName }, 'Consumer created');
    }
  }

  async getConsumer(consumerName: string): Promise<Consumer> {
    return this.js.consumers.get(this.streamName, consumerName);
  }
}
