import type { Logger } from '@gh-automation/logger';
import { connect, type NatsConnection } from '@nats-io/transport-node';

export interface NatsConfig {
  url: string;
  maxReconnectAttempts?: number;
  reconnectTimeWait?: number;
}

let connection: NatsConnection | null = null;
let connectionPromise: Promise<NatsConnection> | null = null;

export async function getNatsConnection(
  config: NatsConfig,
  logger: Logger
): Promise<NatsConnection> {
  if (connection && !connection.isClosed()) {
    return connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  logger.info({ url: config.url }, 'Connecting to NATS');

  connectionPromise = connect({
    servers: config.url,
    maxReconnectAttempts: config.maxReconnectAttempts ?? -1,
    reconnectTimeWait: config.reconnectTimeWait ?? 2000,
  });

  try {
    connection = await connectionPromise;
  } finally {
    connectionPromise = null;
  }

  logger.info('Connected to NATS');

  return connection;
}

export async function closeNatsConnection(logger: Logger): Promise<void> {
  if (connection) {
    const conn = connection;
    connection = null;
    try {
      await conn.drain();
      logger.info('NATS connection closed');
    } catch (err) {
      logger.warn({ err }, 'Error draining NATS connection');
    }
  }
}
