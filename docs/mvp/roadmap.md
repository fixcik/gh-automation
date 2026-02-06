# MVP Roadmap: Claude Job Runner + PR Review Handler

## Context

Система GitHub-автоматизации уже имеет pipeline: `collector → outbox → event-processor-worker → NATS JetStream`. Нужны два новых сервиса:

1. **`claude-job-runner`** — generic исполнитель Claude-задач (получает job request из NATS, клонирует репо, запускает `claude -p`, возвращает результат)
2. **`pr-review-handler`** — диспетчер PR-комментариев (фильтрует NATS-события, запрашивает одобрение в Telegram, диспатчит job'ы, обрабатывает результаты)

**Ключевые решения из брейншторма:**
- Разделение на 2 сервиса (generic runner + тонкий диспетчер)
- MCP server для коммуникации Claude <-> внешний мир (send_notification, ask_user, report_progress)
- grammy для Telegram бота с inline keyboards и auth whitelist
- `git clone` вместо worktree (в контейнере нет основного репо)
- Claude CLI через `npm i -g @anthropic-ai/claude-code` + ANTHROPIC_API_KEY
- Docker volume для кеша gh-pr-threads (`/data/cache/{owner}/{repo}/pr-{N}.json`)
- Доступы Claude настраиваются per-job (tools, model, MCP servers)
- Telegram approval flow перед обработкой PR (кнопки Да/Нет)

---

## Архитектура

```
github.notification.>                claude.job.request.>           claude.job.result.>
┌──────────┐   ┌──────────┐   ┌──────────────┐   ┌────────────────────┐   ┌──────────────────┐
│ collector │──>│ outbox + │──>│ NATS:        │──>│ pr-review-handler  │──>│ NATS:            │
│           │   │ processor│   │ GITHUB_EVENTS│   │                    │   │ CLAUDE_JOBS      │
└──────────┘   └──────────┘   └──────────────┘   │ 1. Filter PR event │   └───────┬──────────┘
                                                   │ 2. Telegram approve│           │
                                                   │ 3. Dispatch job    │           v
                                                   └────────┬───────────┘   ┌──────────────────┐
                                                            │               │ claude-job-runner │
                                                   ┌────────v───────────┐   │ 1. git clone     │
                                                   │ Telegram (grammy)  │   │ 2. MCP server    │
                                                   │ - Approval buttons │   │ 3. claude -p     │
                                                   │ - Notifications    │   │ 4. Result -> NATS│
                                                   │ - ask_user relay   │   └──────────────────┘
                                                   │ - Auth whitelist   │
                                                   └────────────────────┘
```

## NATS Subjects

| Subject | Stream | Publisher | Consumer |
|---------|--------|-----------|----------|
| `github.notification.created` | GITHUB_EVENTS | event-processor-worker | pr-review-handler |
| `github.notification.updated` | GITHUB_EVENTS | event-processor-worker | pr-review-handler |
| `claude.job.request.pr-review` | CLAUDE_JOBS | pr-review-handler | claude-job-runner |
| `claude.job.result.pr-review` | CLAUDE_JOBS | claude-job-runner | pr-review-handler |
| `claude.job.outgoing.pr-review.<jobId>` | CLAUDE_JOBS | MCP server (Claude) | pr-review-handler |
| `claude.job.incoming.pr-review.<jobId>` | CLAUDE_JOBS | pr-review-handler | MCP server (Claude) |

## Зависимости между фазами

```
Phase 0 (infra) ─┬─> Phase 1 (runner core) ──> Phase 2 (runner MCP)
                  │                                      │
                  └─> Phase 3 (handler scaffold) ──> Phase 4 (Telegram) ──> Phase 5 (dispatch)
                                                                                    │
                                                                Phase 2 + Phase 5 ──> Phase 6 (production)
```

Phase 1 и Phase 3 можно делать параллельно после Phase 0.

---

## Phase 0: Infrastructure — packages/nats multi-stream + shared-types job types ✅ DONE

**Status:** Завершена. PR: feature/phase-0-nats-multi-stream

**Goal:** Подготовить общие пакеты для поддержки нескольких NATS стримов и типов job'ов.

**Файлы для модификации:**
- `packages/nats/src/stream-config.ts` — добавить CLAUDE_JOBS stream config + helper type
- `packages/nats/src/publisher.ts` — параметризовать stream (optional, default = GITHUB_EVENTS)
- `packages/nats/src/subscriber.ts` — параметризовать stream (optional, default = GITHUB_EVENTS)
- `packages/nats/src/factory.ts` — optional stream param в фабрики
- `packages/nats/src/index.ts` — export новых типов

**Файлы для создания:**
- `packages/shared-types/src/jobs/job-type.enum.ts`
- `packages/shared-types/src/jobs/claude-job-request.ts`
- `packages/shared-types/src/jobs/claude-job-result.ts`
- `packages/shared-types/src/jobs/claude-job-comm.ts`
- `packages/shared-types/src/jobs/index.ts`

### Ключевые типы

```typescript
// packages/shared-types/src/jobs/job-type.enum.ts
export enum JobType {
  PR_REVIEW = 'pr-review',
}

// packages/shared-types/src/jobs/claude-job-request.ts
export interface ClaudeJobRequest {
  jobId: string;
  jobType: JobType;
  prompt: string;
  repository: {
    url: string;       // https://github.com/owner/repo.git
    branch?: string;   // конкретная ветка для clone
    cloneDepth?: number; // --depth (default: 0 = full)
  };
  claude: {
    model?: string;           // sonnet, opus, haiku
    maxTurns?: number;        // --max-turns
    maxBudgetUsd?: number;    // --max-budget-usd
    timeoutMs?: number;
    allowedTools?: string[];  // --allowedTools
    permissionMode?: string;  // --permission-mode
    mcpServers?: Record<string, McpServerConfig>; // дополнительные MCP
  };
  communication: {
    enableNotifications: boolean;
    enableAskUser: boolean;
    askUserTimeoutMs?: number; // default 5 min
  };
  cache?: {
    paths: string[];  // пути для сохранения между runs (e.g. ".pr-threads-cache")
  };
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

// packages/shared-types/src/jobs/claude-job-result.ts
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

// packages/shared-types/src/jobs/claude-job-comm.ts
export type ClaudeJobCommType = 'notification' | 'question' | 'answer' | 'progress';

export interface ClaudeJobComm {
  jobId: string;
  jobType: JobType;
  type: ClaudeJobCommType;
  content: string;
  level?: 'info' | 'warn' | 'error';  // для notification
  questionId?: string;                  // для question/answer
  createdAt: string;
}
```

### Модификация NatsPublisher

```typescript
// Текущее: constructor(js, jsm, logger) — хардкод STREAM_NAME/STREAM_CONFIG
// Новое: constructor(js, jsm, logger, streamConfig?) — optional, default GITHUB_EVENTS

export interface StreamConfig {
  name: string;
  subjects: string[];
  max_age: bigint;
  max_msgs: number;
  storage: 'file' | 'memory';
  num_replicas: number;
}

// factory.ts
export async function createNatsPublisher(
  nc: NatsConnection, logger: Logger, streamConfig?: StreamConfig
): Promise<NatsPublisher>

export async function createNatsSubscriber(
  nc: NatsConnection, logger: Logger, streamName?: string
): Promise<NatsSubscriber>
```

### Backward Compatibility

- `event-processor-worker` вызывает `createNatsPublisher(nc, logger)` без stream param -> работает как раньше (default = GITHUB_EVENTS)
- Новые сервисы передают `createNatsPublisher(nc, logger, CLAUDE_JOBS_STREAM_CONFIG)`

### Тесты

- `packages/nats/src/__tests__/publisher.test.ts` — проверить что custom stream config используется
- `packages/nats/src/__tests__/subscriber.test.ts` — проверить что custom stream name используется
- `packages/shared-types` — нет runtime логики, только типы

### Верификация

1. `pnpm build` — все пакеты собираются
2. `pnpm --filter @gh-automation/event-processor-worker test run` — существующие тесты не сломались
3. `pnpm --filter @gh-automation/nats test run` — новые тесты проходят

---

## Phase 1: claude-job-runner — scaffold + core ✅ DONE

**Status:** Завершена. PR: https://github.com/fixcik/gh-automation/pull/8

**Goal:** Сервис получает job request из NATS, клонирует репо, запускает `claude -p`, возвращает результат.

**Файлы для создания:**
```
apps/claude-job-runner/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                     # Entry point, NATS lifecycle, shutdown
    config.ts                    # Env parsing
    clone-manager.ts             # git clone + cleanup
    claude-runner.ts             # claude -p invocation via execa
    claude-config-builder.ts     # Генерация CLI args + MCP config JSON
    job-consumer.ts              # NATS consumer loop + msg.working() heartbeat
    job-executor.ts              # Orchestrator: clone -> claude -> publish result
    __tests__/
      config.test.ts
      clone-manager.test.ts
      claude-config-builder.test.ts
      claude-runner.test.ts
      job-executor.test.ts
      job-consumer.test.ts
```

### Ключевые компоненты

**CloneManager:**
```typescript
class CloneManager {
  constructor(baseDir: string, logger: Logger) {}

  // git clone --branch <branch> [--depth N] <url> <path>
  async clone(repo: ClaudeJobRequest['repository']): Promise<string>  // returns clone path

  // rm -rf <path>
  async cleanup(clonePath: string): Promise<void>

  // Восстановить cached файлы из /data/cache/ в clone
  async restoreCache(clonePath: string, jobId: string, cachePaths: string[]): Promise<void>

  // Сохранить cached файлы из clone в /data/cache/
  async saveCache(clonePath: string, jobId: string, cachePaths: string[]): Promise<void>
}
```
Путь клона: `<baseDir>/job-<jobId>/`

**ClaudeConfigBuilder:**
```typescript
class ClaudeConfigBuilder {
  // Генерирует CLI аргументы из ClaudeJobRequest.claude
  buildArgs(config: ClaudeJobRequest['claude']): string[]

  // Генерирует временный .claude-mcp.json для job'а
  // Включает наш MCP comm server + дополнительные из request
  buildMcpConfig(jobId: string, jobType: string, commMcpCommand: string,
                 extraServers?: Record<string, McpServerConfig>): string  // returns path to temp file
}
```

Результат `buildArgs`:
```
['-p', '--allowedTools', 'Edit,Write,...', '--max-budget-usd', '5',
 '--model', 'sonnet', '--max-turns', '50', '--permission-mode', 'bypassPermissions']
```

**ClaudeRunner:**
```typescript
class ClaudeRunner {
  constructor(logger: Logger) {}

  async run(prompt: string, cwd: string, args: string[], timeoutMs: number): Promise<ClaudeResult>
}
```
Использует `execa('claude', args, { cwd, input: prompt, timeout })`.

**JobConsumer:**
```typescript
class JobConsumer {
  constructor(subscriber: NatsSubscriber, logger: Logger, config: ConsumerConfig) {}

  async init(): Promise<void>           // ensureConsumer
  async listen(handler: JobHandler): Promise<void>  // consume loop + msg.working() heartbeat
  async stop(): Promise<void>           // close consumer messages
}
```

Heartbeat: `setInterval(() => msg.working(), 30_000)` — очищается после обработки.

**JobExecutor:**
```typescript
class JobExecutor {
  constructor(cloneManager, claudeRunner, claudeConfigBuilder, publisher, logger) {}

  async execute(request: ClaudeJobRequest): Promise<ClaudeJobResult>
  // 1. clone repo
  // 2. restore cache
  // 3. build claude args + MCP config
  // 4. run claude
  // 5. save cache
  // 6. publish result to NATS (claude.job.result.<jobType>)
  // 7. cleanup clone (finally)
}
```

### Environment Variables

```bash
NATS_URL=nats://localhost:4222
NATS_CONSUMER_NAME=claude-job-runner
NATS_ACK_WAIT_MS=900000          # 15 min (Claude может работать долго)
CLONE_BASE_DIR=/tmp/claude-jobs
CACHE_BASE_DIR=/data/cache       # Docker volume
LOG_LEVEL=info
```

### Тесты

| Файл | Что тестируем |
|------|--------------|
| config.test.ts | defaults, env parsing, invalid values |
| clone-manager.test.ts | buildClonePath, buildCloneArgs |
| claude-config-builder.test.ts | buildArgs, buildMcpConfig JSON structure |
| claude-runner.test.ts | buildArgs (unit), не вызываем execa |
| job-executor.test.ts | full flow с моками (clone -> claude -> result -> cleanup) |
| job-consumer.test.ts | ensureConsumer config, parseMessage |

### Верификация

1. `pnpm --filter @gh-automation/claude-job-runner build`
2. `pnpm --filter @gh-automation/claude-job-runner test run`
3. Ручной тест: опубликовать job request в NATS -> runner должен подхватить, склонировать, попытаться запустить claude

---

## Phase 2: claude-job-runner — MCP communication server

**Goal:** MCP server который Claude использует для коммуникации с внешним миром через NATS.

**Файлы для создания:**
```
apps/claude-job-runner/
  src/
    mcp-server/
      index.ts            # Standalone stdio MCP server entry point
      tools.ts            # Tool definitions: send_notification, ask_user, report_progress
      nats-comm.ts        # NATS publish/subscribe для MCP tools
```

**Зависимость:** `@modelcontextprotocol/sdk` (MCP SDK для stdio server)

### Как это работает

1. `ClaudeConfigBuilder` генерирует MCP config JSON с нашим comm server:
   ```json
   {
     "mcpServers": {
       "job-comm": {
         "command": "node",
         "args": ["/app/apps/claude-job-runner/dist/mcp-server/index.js"],
         "env": {
           "NATS_URL": "nats://nats:4222",
           "JOB_ID": "xxx",
           "JOB_TYPE": "pr-review"
         }
       }
     }
   }
   ```

2. Claude запускает MCP server как subprocess при старте
3. MCP server подключается к NATS самостоятельно
4. Tools:

**send_notification(message, level):**
- Fire & forget -> publish в `claude.job.outgoing.<jobType>.<jobId>`
- Payload: `ClaudeJobComm { type: 'notification', content, level }`

**ask_user(question):**
- Publish question в `claude.job.outgoing.<jobType>.<jobId>`
- Subscribe на `claude.job.incoming.<jobType>.<jobId>` и ждать ответ
- Timeout: `ASK_USER_TIMEOUT_MS` (default 5 мин)
- Возвращает ответ пользователя или "No response (timeout)"

**report_progress(status):**
- Fire & forget -> publish в `claude.job.outgoing.<jobType>.<jobId>`
- Payload: `ClaudeJobComm { type: 'progress', content: status }`

### Тесты

- `mcp-server/tools.test.ts` — tool definitions (names, schemas)
- `mcp-server/nats-comm.test.ts` — publish/subscribe с моками NATS

### Верификация

1. `pnpm --filter @gh-automation/claude-job-runner build` — MCP server компилируется
2. Ручной тест: запустить MCP server standalone с env vars -> вызвать tool -> проверить что message в NATS

---

## Phase 3: pr-review-handler — scaffold + NATS listener

**Goal:** Сервис подписывается на GITHUB_EVENTS, фильтрует PR-комментарии, дедуплицирует.

**Файлы для создания:**
```
apps/pr-review-handler/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                          # Entry point
    config.ts                         # Env parsing
    nats/
      notification-listener.ts        # NATS consumer на GITHUB_EVENTS
      event-filter.ts                 # isPRCommentEvent
    dedup/
      deduplication-guard.ts          # In-memory lock + cooldown
    __tests__/
      config.test.ts
      event-filter.test.ts
      deduplication-guard.test.ts
      notification-listener.test.ts
```

### Ключевые компоненты

**EventFilter:** (идентичен монолитному плану)
```typescript
function isPRCommentEvent(payload: GithubNotificationEvent['payload']): boolean {
  return (
    payload.subjectType === SubjectType.PULL_REQUEST &&
    ['comment', 'mention'].includes(payload.reason) &&  // НЕ review_requested
    payload.subjectNumber !== null
  );
}
```

**DeduplicationGuard:** in-memory Map с cooldown + in-flight tracking.

**NotificationListener:** обёртка над NatsSubscriber для GITHUB_EVENTS стрима.

### Environment Variables

```bash
NATS_URL=nats://localhost:4222
NATS_CONSUMER_NAME=pr-review-handler
NATS_ACK_WAIT_MS=600000
PR_HANDLER_COOLDOWN_MS=300000
LOG_LEVEL=info
```

### Тесты

Те же что в монолитном плане 1: config (3), event-filter (7), dedup-guard (7), listener (3) = ~20 тестов.

### Верификация

1. `pnpm --filter @gh-automation/pr-review-handler build`
2. `pnpm --filter @gh-automation/pr-review-handler test run`
3. Ручной: подключиться к NATS -> слушать события -> логировать отфильтрованные PR events

---

## Phase 4: pr-review-handler — Telegram bot

**Goal:** grammy бот с auth whitelist, approval flow (inline buttons), отправка уведомлений, relay для ask_user.

**Файлы для создания:**
```
apps/pr-review-handler/
  src/
    telegram/
      bot.ts                    # grammy Bot instance, middleware, long-polling
      auth-middleware.ts         # Whitelist по user ID
      approval-handler.ts       # Inline keyboard: "Обработать PR? Да/Нет"
      notification-sender.ts    # Отправка уведомлений (результаты, ошибки)
      message-formatter.ts      # Форматирование HTML для Telegram
    __tests__/
      auth-middleware.test.ts
      approval-handler.test.ts
      message-formatter.test.ts
      notification-sender.test.ts
```

**Зависимость:** `grammy`

### Ключевые компоненты

**AuthMiddleware:**
```typescript
// Whitelist из env: TELEGRAM_ALLOWED_USERS=123456,789012
function authMiddleware(allowedUserIds: number[]): MiddlewareFn {
  return (ctx, next) => {
    if (!allowedUserIds.includes(ctx.from?.id ?? 0)) {
      return; // молча игнорируем
    }
    return next();
  };
}
```

**ApprovalHandler:**
```typescript
// При получении PR event -> отправить сообщение с inline keyboard
async function sendApprovalRequest(bot, chatId, payload): Promise<void> {
  await bot.api.sendMessage(chatId, formatApprovalMessage(payload), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: 'Yes', callback_data: `approve:${repository}:${prNumber}` },
        { text: 'No', callback_data: `reject:${repository}:${prNumber}` },
      ]],
    },
  });
}

// Callback handler
bot.callbackQuery(/^approve:(.+):(\d+)$/, async (ctx) => {
  // -> dispatch job
  await ctx.answerCallbackQuery('Launching processing...');
  await ctx.editMessageReplyMarkup(undefined); // убрать кнопки
});
```

**AskUser relay (NATS -> Telegram -> NATS):**
```typescript
// Получить вопрос от Claude через NATS (claude.job.outgoing.pr-review.<jobId>)
// -> Отправить в Telegram с reply keyboard
// -> Получить ответ пользователя
// -> Publish в NATS (claude.job.incoming.pr-review.<jobId>)

// Для MVP: используем force_reply для получения ответа
```

**NotificationSender:**
```typescript
class NotificationSender {
  async sendResult(report: ClaudeJobResult): Promise<void>  // статистика + ссылка на PR
  async sendError(context, error: Error): Promise<void>
  async sendProgress(jobId: string, status: string): Promise<void>
}
```

### Environment Variables

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-xxx
TELEGRAM_CHAT_ID=-100xxx
TELEGRAM_ALLOWED_USERS=123456,789012   # user IDs через запятую
```

### Тесты

| Файл | Что тестируем |
|------|--------------|
| auth-middleware.test.ts | allowed user passes, unknown user blocked |
| approval-handler.test.ts | callback_data format, approve/reject parsing |
| message-formatter.test.ts | HTML formatting, truncation, escaping |
| notification-sender.test.ts | send with mock bot API |

### Верификация

1. `pnpm --filter @gh-automation/pr-review-handler test run`
2. Ручной: запустить бот -> отправить `/start` -> проверить auth -> отправить тестовое approval -> нажать кнопку

---

## Phase 5: pr-review-handler — job dispatch + result/comm handling

**Goal:** Связать всё: при одобрении в Telegram -> dispatch job -> обработать результат -> Telegram notification.

**Файлы для создания:**
```
apps/pr-review-handler/
  src/
    jobs/
      prompt-builder.ts          # Генерация промпта для PR review
      job-dispatcher.ts          # Создать ClaudeJobRequest, publish в CLAUDE_JOBS
      result-handler.ts          # NATS consumer на claude.job.result.pr-review
      comm-handler.ts            # NATS consumer на claude.job.outgoing.pr-review.*
    __tests__/
      prompt-builder.test.ts
      job-dispatcher.test.ts
      result-handler.test.ts
      comm-handler.test.ts
```

### Ключевые компоненты

**PromptBuilder:**
```typescript
function buildPrompt(repository: string, prNumber: number): string {
  // Инструкции для Claude:
  // - Использовать npx gh-pr-threads <url> для получения комментариев
  // - Проанализировать и исправить каждый комментарий
  // - Сделать коммит и push
  // - Использовать send_notification для прогресса
  // - Использовать ask_user если что-то неясно
}
```

**JobDispatcher:**
```typescript
class JobDispatcher {
  constructor(publisher: NatsPublisher, logger: Logger) {}

  async dispatch(payload: GithubNotificationEvent['payload']): Promise<string> {
    const jobId = crypto.randomUUID();
    const request: ClaudeJobRequest = {
      jobId,
      jobType: JobType.PR_REVIEW,
      prompt: buildPrompt(payload.repository, payload.subjectNumber!),
      repository: {
        url: `https://github.com/${payload.repository}.git`,
        branch: await getBranchName(payload.repository, payload.subjectNumber!),
      },
      claude: {
        model: 'sonnet',
        maxTurns: 50,
        maxBudgetUsd: 5,
        timeoutMs: 300_000,
        allowedTools: ['Edit', 'Write', 'Read', 'Glob', 'Grep', 'Bash(git:*)', 'Bash(npm:*)', 'Bash(npx gh-pr-threads:*)'],
        permissionMode: 'bypassPermissions',
        mcpServers: {
          // serena, sequential-thinking -- задаются через конфиг runner'а
        },
      },
      communication: {
        enableNotifications: true,
        enableAskUser: true,
        askUserTimeoutMs: 300_000,
      },
      cache: {
        paths: ['.pr-threads-cache'],
      },
      metadata: {
        repository: payload.repository,
        prNumber: payload.subjectNumber,
        prTitle: payload.subjectTitle,
        reason: payload.reason,
      },
      createdAt: new Date().toISOString(),
    };

    await this.publisher.publish({
      eventId: jobId,
      eventType: `claude.job.request.${JobType.PR_REVIEW}`,
      aggregateId: `${payload.repository}:${payload.subjectNumber}`,
      payload: request,
    });

    return jobId;
  }
}
```

**ResultHandler:**
```typescript
class ResultHandler {
  // NATS consumer на claude.job.result.pr-review
  // При получении результата -> format -> Telegram notification
  // status 'completed' -> sendResult (сколько исправил, скипнул, ссылка на PR)
  // status 'failed'/'timeout' -> sendError
}
```

**CommHandler:**
```typescript
class CommHandler {
  // NATS consumer на claude.job.outgoing.pr-review.*
  // type 'notification' -> Telegram notification
  // type 'question' -> Telegram message с force_reply -> ждать ответ -> publish в incoming
  // type 'progress' -> обновить статус (или игнорировать в MVP)
}
```

### Wiring в index.ts

3 параллельных consumer'а:
```typescript
// 1. NotificationListener (GITHUB_EVENTS) -> filter -> dedup -> approval request
// 2. ResultHandler (CLAUDE_JOBS, claude.job.result.pr-review) -> Telegram
// 3. CommHandler (CLAUDE_JOBS, claude.job.outgoing.pr-review.>) -> Telegram relay

await Promise.all([
  notificationListener.listen(approvalFlow),
  resultHandler.listen(),
  commHandler.listen(),
]);
```

### Тесты

| Файл | Что тестируем |
|------|--------------|
| prompt-builder.test.ts | содержит repo, PR #, gh-pr-threads команду |
| job-dispatcher.test.ts | формат ClaudeJobRequest, publish вызов |
| result-handler.test.ts | парсинг результата, вызов Telegram |
| comm-handler.test.ts | routing по type (notification/question/progress) |

### Верификация

1. `pnpm --filter @gh-automation/pr-review-handler test run`
2. E2E: publish test event в GITHUB_EVENTS -> pr-review-handler получает -> Telegram approval -> нажать "Да" -> job request в CLAUDE_JOBS

---

## Phase 6: Production — Docker + compose

**Goal:** Контейнеризация обоих сервисов, интеграция в docker-compose.

### claude-job-runner Dockerfile

Особенности:
- Runtime: `git`, `gh` CLI, `claude` CLI (`npm i -g @anthropic-ai/claude-code`)
- MCP серверы: `@anthropic-ai/claude-mcp-server-*` (если нужны), `@modelcontextprotocol/sdk`
- Volume mount: `/data/cache` для gh-pr-threads кеша
- Volume mount: `/tmp/claude-jobs` для клонов (tmpfs?)
- `GH_TOKEN` и `ANTHROPIC_API_KEY` через env

### pr-review-handler Dockerfile

Особенности:
- Только Node.js runtime (без git, без claude)
- `gh` CLI нужен для `gh pr view` (получение branch name)
- grammy long-polling (не нужен incoming webhook)

### docker-compose additions

```yaml
claude-job-runner:
  depends_on:
    nats: { condition: service_healthy }
  volumes:
    - claude-cache:/data/cache
    - ~/.config/gh:/home/app/.config/gh:ro
  environment:
    NATS_URL, ANTHROPIC_API_KEY, GH_TOKEN, CLONE_BASE_DIR, CACHE_BASE_DIR, LOG_LEVEL

pr-review-handler:
  depends_on:
    nats: { condition: service_healthy }
  volumes:
    - ~/.config/gh:/home/app/.config/gh:ro
  environment:
    NATS_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_ALLOWED_USERS, GH_TOKEN, LOG_LEVEL
```

### .env.example additions

```bash
# Claude Job Runner
ANTHROPIC_API_KEY=sk-ant-xxx
CLONE_BASE_DIR=/tmp/claude-jobs
CACHE_BASE_DIR=/data/cache

# PR Review Handler
TELEGRAM_BOT_TOKEN=123456:ABC-xxx
TELEGRAM_CHAT_ID=-100xxx
TELEGRAM_ALLOWED_USERS=123456
```

### Верификация

1. `docker-compose build claude-job-runner pr-review-handler`
2. `docker-compose up -d nats`
3. `docker-compose up pr-review-handler` -> бот стартует, подключается к NATS
4. `docker-compose up claude-job-runner` -> runner стартует, ждёт job requests
5. E2E smoke test: collector -> processor -> NATS -> handler -> Telegram -> approve -> runner -> Claude -> result -> Telegram

---

## Порядок реализации (рекомендация)

1. **Phase 0** (1-2 часа) — быстрая подготовка инфраструктуры
2. **Phase 3** (2-3 часа) — handler scaffold (можно тестировать с NATS сразу)
3. **Phase 1** (3-4 часа) — runner core (самый объёмный)
4. **Phase 4** (2-3 часа) — Telegram bot
5. **Phase 5** (2-3 часа) — dispatch + results (связывает handler с runner)
6. **Phase 2** (3-4 часа) — MCP server (можно отложить, MVP работает без ask_user)
7. **Phase 6** (1-2 часа) — Docker (финализация)

**Итого MVP:** ~15-20 часов работы

## Ключевые файлы для переиспользования

| Файл | Что берём |
|------|-----------|
| `packages/nats/src/subscriber.ts` | NatsSubscriber API (ensureConsumer, getConsumer) |
| `packages/nats/src/publisher.ts` | NatsPublisher API (ensureStream, publish) |
| `packages/nats/src/factory.ts` | createNatsPublisher, createNatsSubscriber |
| `packages/nats/src/connection.ts` | getNatsConnection, closeNatsConnection |
| `apps/event-processor-worker/src/index.ts` | Lifecycle/shutdown pattern |
| `packages/shared-types/src/events/` | GithubNotificationEvent payload structure |
| `packages/shared-types/src/enums/` | SubjectType, NotificationReason |
| `packages/logger/src/logger.ts` | createLogger, Logger type |

## Что делать с устаревшими планами

После утверждения этого roadmap:
- Удалить `.claude/plans/pr-review/2026-02-06-pr-review-handler-{1,2,3,4}.md` (устарели)
- `golden-chasing-pike.md` — пометить как superseded
- `vast-foraging-wren.md` — пометить как superseded (заменён этим roadmap)
