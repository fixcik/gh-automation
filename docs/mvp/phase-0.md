# Phase 0: Infrastructure — NATS Multi-Stream + Job Types

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Параметризовать пакет `@gh-automation/nats` для работы с несколькими стримами и добавить типы job'ов в `@gh-automation/shared-types`.

**Architecture:** Текущий `packages/nats` жёстко привязан к стриму `GITHUB_EVENTS`. Мы добавим параметр `StreamConfig` в `NatsPublisher`/`NatsSubscriber` и фабрики, с default = GITHUB_EVENTS для backward compatibility. В `shared-types` создадим новый модуль `jobs/` с интерфейсами для Claude job pipeline.

**Tech Stack:** TypeScript, NATS JetStream (`@nats-io/jetstream`), Vitest

---

## Task 1: Добавить CLAUDE_JOBS stream config

**Files:**
- Modify: `packages/nats/src/stream-config.ts`

**Step 1: Добавить StreamConfig type и CLAUDE_JOBS конфиг**

В `stream-config.ts` сейчас экспортируются `STREAM_NAME`, `STREAM_SUBJECTS`, `STREAM_CONFIG` — всё захардкожено под GITHUB_EVENTS.

Добавить:
1. Именованный тип `StreamConfig` (выведен из текущего STREAM_CONFIG)
2. Конфиг `CLAUDE_JOBS_STREAM_CONFIG`
3. Переименовать существующие константы для ясности: `GITHUB_EVENTS_STREAM_CONFIG`

```typescript
import { nanos } from '@nats-io/nats-core/internal';

// --- Stream config type ---

export interface StreamConfig {
  name: string;
  subjects: string[];
  max_age: bigint;
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
  max_age: nanos(7 * 24 * 60 * 60 * 1_000),
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
  max_age: nanos(7 * 24 * 60 * 60 * 1_000),
  max_msgs: 100_000,
  storage: 'file',
  num_replicas: 1,
};
```

**Step 2: Verify build**

Run: `pnpm --filter @gh-automation/nats build`
Expected: SUCCESS (тип StreamConfig и новые константы экспортированы)

**Step 3: Commit**

```bash
git add packages/nats/src/stream-config.ts
git commit -m "feat(nats): add StreamConfig type and CLAUDE_JOBS stream config"
```

---

## Task 2: Параметризовать NatsPublisher

**Files:**
- Modify: `packages/nats/src/publisher.ts`

**Step 1: Добавить streamConfig в конструктор с default**

Текущий конструктор:
```typescript
constructor(
  private readonly js: JetStreamClient,
  private readonly jsm: JetStreamManager,
  private readonly logger: Logger
) {}
```

Новый:
```typescript
import type { StreamConfig } from './stream-config.js';
import { STREAM_CONFIG } from './stream-config.js';

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
```

**Backward compatibility:** `streamConfig` — optional, default = `STREAM_CONFIG` (GITHUB_EVENTS). Все существующие вызовы `new NatsPublisher(js, jsm, logger)` продолжают работать.

**Step 2: Verify build**

Run: `pnpm --filter @gh-automation/nats build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add packages/nats/src/publisher.ts
git commit -m "feat(nats): parameterize NatsPublisher with StreamConfig"
```

---

## Task 3: Параметризовать NatsSubscriber

**Files:**
- Modify: `packages/nats/src/subscriber.ts`

**Step 1: Добавить streamName в конструктор с default**

Текущий: хардкод `STREAM_NAME` в `ensureConsumer` и `getConsumer`.

Новый:
```typescript
import { STREAM_NAME } from './stream-config.js';

export class NatsSubscriber {
  private readonly streamName: string;

  constructor(
    private readonly js: JetStreamClient,
    private readonly jsm: JetStreamManager,
    private readonly logger: Logger,
    streamName?: string
  ) {
    this.streamName = streamName ?? STREAM_NAME;
  }

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
        ack_wait: opts.ackWaitMs * 1_000_000,
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
```

**Step 2: Verify build**

Run: `pnpm --filter @gh-automation/nats build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add packages/nats/src/subscriber.ts
git commit -m "feat(nats): parameterize NatsSubscriber with streamName"
```

---

## Task 4: Параметризовать фабрики

**Files:**
- Modify: `packages/nats/src/factory.ts`

**Step 1: Добавить optional streamConfig/streamName в фабрики**

```typescript
import type { Logger } from '@gh-automation/logger';
import { jetstream, jetstreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';
import { NatsPublisher } from './publisher.js';
import type { StreamConfig } from './stream-config.js';
import { NatsSubscriber } from './subscriber.js';

export async function createNatsPublisher(
  nc: NatsConnection,
  logger: Logger,
  streamConfig?: StreamConfig
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
  streamName?: string
): Promise<NatsSubscriber> {
  const js = jetstream(nc);
  const jsm = await jetstreamManager(nc);
  return new NatsSubscriber(js, jsm, logger, streamName);
}
```

**Backward compatibility:** `event-processor-worker` вызывает `createNatsPublisher(nc, logger)` без третьего аргумента — продолжает работать с default GITHUB_EVENTS.

**Step 2: Verify build**

Run: `pnpm --filter @gh-automation/nats build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add packages/nats/src/factory.ts
git commit -m "feat(nats): add optional stream params to factory functions"
```

---

## Task 5: Обновить exports в index.ts

**Files:**
- Modify: `packages/nats/src/index.ts`

**Step 1: Добавить новые exports**

```typescript
// Connection
export type { NatsConfig } from './connection.js';
export { closeNatsConnection, getNatsConnection } from './connection.js';

// Factory
export { createNatsPublisher, createNatsSubscriber } from './factory.js';

// Publisher
export type { PublishableEvent } from './publisher.js';
export { NatsPublisher } from './publisher.js';

// Stream config
export type { StreamConfig } from './stream-config.js';
export {
  STREAM_CONFIG,
  STREAM_NAME,
  STREAM_SUBJECTS,
  GITHUB_EVENTS_STREAM_CONFIG,
  CLAUDE_JOBS_STREAM_CONFIG,
  CLAUDE_JOBS_STREAM_NAME,
  CLAUDE_JOBS_STREAM_SUBJECTS,
} from './stream-config.js';

// Subscriber
export type { SubscriberConfig } from './subscriber.js';
export { NatsSubscriber } from './subscriber.js';
```

**Step 2: Verify build**

Run: `pnpm --filter @gh-automation/nats build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add packages/nats/src/index.ts
git commit -m "feat(nats): export StreamConfig type and CLAUDE_JOBS constants"
```

---

## Task 6: Написать тесты для NatsPublisher с custom stream

**Files:**
- Modify: `packages/nats/src/__tests__/publisher.test.ts`

**Step 1: Добавить тесты для custom stream config**

Добавить новый `describe` блок в конец файла:

```typescript
describe('NatsPublisher with custom stream config', () => {
  let publisher: NatsPublisher;
  let mockJs: ReturnType<typeof createMockJs>;
  let mockJsm: ReturnType<typeof createMockJsm>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  const customStreamConfig = {
    name: 'CLAUDE_JOBS',
    subjects: ['claude.job.>'],
    max_age: BigInt(604800000000000),
    max_msgs: 100_000,
    storage: 'file' as const,
    num_replicas: 1,
  };

  beforeEach(() => {
    mockJs = createMockJs();
    mockJsm = createMockJsm();
    mockLogger = createMockLogger();
    publisher = new NatsPublisher(mockJs as any, mockJsm as any, mockLogger, customStreamConfig);
  });

  it('should check custom stream name in ensureStream', async () => {
    await publisher.ensureStream();

    expect(mockJsm.streams.info).toHaveBeenCalledWith('CLAUDE_JOBS');
  });

  it('should create custom stream if it does not exist', async () => {
    mockJsm.streams.info.mockRejectedValueOnce(new Error('stream not found'));

    await publisher.ensureStream();

    expect(mockJsm.streams.add).toHaveBeenCalledWith(customStreamConfig);
  });

  it('should use default GITHUB_EVENTS stream when no config provided', () => {
    const defaultPublisher = new NatsPublisher(mockJs as any, mockJsm as any, mockLogger);

    // Verify by calling ensureStream and checking the stream name
    defaultPublisher.ensureStream();

    expect(mockJsm.streams.info).toHaveBeenCalledWith('GITHUB_EVENTS');
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `pnpm --filter @gh-automation/nats test run`
Expected: ALL PASS (7 existing + 3 new = 10 tests)

**Step 3: Commit**

```bash
git add packages/nats/src/__tests__/publisher.test.ts
git commit -m "test(nats): add tests for NatsPublisher with custom stream config"
```

---

## Task 7: Написать тесты для NatsSubscriber с custom stream

**Files:**
- Modify: `packages/nats/src/__tests__/subscriber.test.ts`

**Step 1: Добавить тесты для custom stream name**

Добавить новый `describe` блок в конец файла:

```typescript
describe('NatsSubscriber with custom stream name', () => {
  let subscriber: NatsSubscriber;
  let mockJs: ReturnType<typeof createMockJs>;
  let mockJsm: ReturnType<typeof createMockJsm>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockJs = createMockJs();
    mockJsm = createMockJsm();
    mockLogger = createMockLogger();
    subscriber = new NatsSubscriber(mockJs as any, mockJsm as any, mockLogger, 'CLAUDE_JOBS');
  });

  it('should use custom stream name for ensureConsumer', async () => {
    mockJsm.consumers.info.mockRejectedValueOnce(new Error('consumer not found'));

    await subscriber.ensureConsumer('job-runner');

    expect(mockJsm.consumers.add).toHaveBeenCalledWith(
      'CLAUDE_JOBS',
      expect.objectContaining({
        durable_name: 'job-runner',
      })
    );
  });

  it('should use custom stream name for getConsumer', async () => {
    await subscriber.getConsumer('job-runner');

    expect(mockJs.consumers.get).toHaveBeenCalledWith('CLAUDE_JOBS', 'job-runner');
  });

  it('should use default GITHUB_EVENTS stream when no name provided', async () => {
    const defaultSubscriber = new NatsSubscriber(mockJs as any, mockJsm as any, mockLogger);

    await defaultSubscriber.ensureConsumer('my-service');

    expect(mockJsm.consumers.info).toHaveBeenCalledWith('GITHUB_EVENTS', 'my-service');
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `pnpm --filter @gh-automation/nats test run`
Expected: ALL PASS (4 existing + 3 new = 7 tests)

**Step 3: Commit**

```bash
git add packages/nats/src/__tests__/subscriber.test.ts
git commit -m "test(nats): add tests for NatsSubscriber with custom stream name"
```

---

## Task 8: Создать job types в shared-types

**Files:**
- Create: `packages/shared-types/src/jobs/job-type.enum.ts`
- Create: `packages/shared-types/src/jobs/claude-job-request.ts`
- Create: `packages/shared-types/src/jobs/claude-job-result.ts`
- Create: `packages/shared-types/src/jobs/claude-job-comm.ts`
- Create: `packages/shared-types/src/jobs/index.ts`
- Modify: `packages/shared-types/src/index.ts`

**Step 1: Создать `packages/shared-types/src/jobs/job-type.enum.ts`**

```typescript
export enum JobType {
  PR_REVIEW = 'pr-review',
}
```

**Step 2: Создать `packages/shared-types/src/jobs/claude-job-request.ts`**

```typescript
import type { JobType } from './job-type.enum.js';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ClaudeJobRequest {
  jobId: string;
  jobType: JobType;
  prompt: string;
  repository: {
    url: string;
    branch?: string;
    cloneDepth?: number;
  };
  claude: {
    model?: string;
    maxTurns?: number;
    maxBudgetUsd?: number;
    timeoutMs?: number;
    allowedTools?: string[];
    permissionMode?: string;
    mcpServers?: Record<string, McpServerConfig>;
  };
  communication: {
    enableNotifications: boolean;
    enableAskUser: boolean;
    askUserTimeoutMs?: number;
  };
  cache?: {
    paths: string[];
  };
  metadata: Record<string, unknown>;
  createdAt: string;
}
```

**Step 3: Создать `packages/shared-types/src/jobs/claude-job-result.ts`**

```typescript
import type { JobType } from './job-type.enum.js';

export interface ClaudeJobResult {
  jobId: string;
  jobType: JobType;
  status: 'completed' | 'failed' | 'timeout';
  result?: {
    summary: string;
    output: string;
    exitCode: number;
  };
  error?: {
    message: string;
    exitCode?: number;
  };
  timing: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  metadata: Record<string, unknown>;
}
```

**Step 4: Создать `packages/shared-types/src/jobs/claude-job-comm.ts`**

```typescript
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
```

**Step 5: Создать `packages/shared-types/src/jobs/index.ts`**

```typescript
export { JobType } from './job-type.enum.js';
export type { ClaudeJobRequest, McpServerConfig } from './claude-job-request.js';
export type { ClaudeJobResult } from './claude-job-result.js';
export type { ClaudeJobComm, ClaudeJobCommType } from './claude-job-comm.js';
```

**Step 6: Обновить `packages/shared-types/src/index.ts`**

```typescript
// Enums

export { EventStatus } from './enums/event-status.enum';
export { NotificationReason } from './enums/notification-reason.enum';
export { SubjectType } from './enums/subject-type.enum';

// Events
export type { GithubNotificationEvent } from './events/github-notification.event';

// Jobs
export { JobType } from './jobs/index';
export type {
  ClaudeJobRequest,
  McpServerConfig,
  ClaudeJobResult,
  ClaudeJobComm,
  ClaudeJobCommType,
} from './jobs/index';
```

**Step 7: Verify build**

Run: `pnpm --filter @gh-automation/shared-types build`
Expected: SUCCESS

**Step 8: Commit**

```bash
git add packages/shared-types/src/jobs/ packages/shared-types/src/index.ts
git commit -m "feat(shared-types): add Claude job types (request, result, comm)"
```

---

## Task 9: Полная верификация

**Step 1: Собрать все пакеты**

Run: `pnpm build`
Expected: SUCCESS (все пакеты собираются, Turborepo кеширует что можно)

**Step 2: Прогнать тесты nats пакета**

Run: `pnpm --filter @gh-automation/nats test run`
Expected: ALL PASS (10 publisher + 7 subscriber = 17 tests)

**Step 3: Прогнать тесты event-processor-worker (backward compat)**

Run: `pnpm --filter @gh-automation/event-processor-worker test run`
Expected: ALL PASS (существующие тесты не сломались, т.к. все параметры optional с defaults)

**Step 4: Commit (если были мелкие фиксы)**

Если фиксов не было — этот шаг пропускаем.

---

## Чеклист готовности Phase 0

- [ ] `StreamConfig` тип экспортируется из `@gh-automation/nats`
- [ ] `CLAUDE_JOBS_STREAM_CONFIG` экспортируется из `@gh-automation/nats`
- [ ] `NatsPublisher` принимает optional `StreamConfig` (default = GITHUB_EVENTS)
- [ ] `NatsSubscriber` принимает optional `streamName` (default = GITHUB_EVENTS)
- [ ] `createNatsPublisher()` пробрасывает optional `StreamConfig`
- [ ] `createNatsSubscriber()` пробрасывает optional `streamName`
- [ ] `event-processor-worker` тесты проходят (backward compat)
- [ ] `JobType`, `ClaudeJobRequest`, `ClaudeJobResult`, `ClaudeJobComm` экспортируются из `@gh-automation/shared-types`
- [ ] `pnpm build` — все пакеты собираются
- [ ] Новые тесты покрывают custom stream config/name
