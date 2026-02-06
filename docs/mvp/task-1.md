# Task 1: claude-job-runner — Scaffold + Core

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Создать сервис `claude-job-runner`, который получает job request из NATS (стрим `CLAUDE_JOBS`), клонирует репо, запускает `claude -p` через CLI, и публикует результат обратно в NATS.

**Architecture:** Сервис подписывается на `claude.job.request.>` в стриме `CLAUDE_JOBS`. При получении `ClaudeJobRequest`:
1. Клонирует репозиторий (`git clone`)
2. Восстанавливает кеш (если указан)
3. Генерирует CLI-аргументы и MCP-конфиг для Claude
4. Запускает `claude -p <prompt>` через `execa` в директории клона
5. Собирает результат и публикует `ClaudeJobResult` в `claude.job.result.<jobType>`
6. Очищает клон (в `finally`)

**Tech Stack:** TypeScript, `execa` (subprocess), `@gh-automation/nats`, `@gh-automation/shared-types`, Vitest

**Dependencies от Task 0:**
- `@gh-automation/nats` — `CLAUDE_JOBS_STREAM_CONFIG`, `CLAUDE_JOBS_STREAM_NAME`, `createNatsPublisher`, `createNatsSubscriber`
- `@gh-automation/shared-types` — `ClaudeJobRequest`, `ClaudeJobResult`, `JobType`

---

## Структура файлов

```
apps/claude-job-runner/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                     # Entry point, NATS lifecycle, shutdown
    config.ts                    # Env parsing + defaults
    clone-manager.ts             # git clone + cleanup + cache restore/save
    claude-runner.ts             # claude -p invocation via execa
    claude-config-builder.ts     # CLI args + MCP config JSON generation
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

---

## Task 1: Scaffold — package.json, tsconfig.json, vitest.config.ts

**Files:**
- Create: `apps/claude-job-runner/package.json`
- Create: `apps/claude-job-runner/tsconfig.json`
- Create: `apps/claude-job-runner/vitest.config.ts`

**Step 1: Создать `package.json`**

```json
{
  "name": "@gh-automation/claude-job-runner",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch --env-file=../../.env src/index.ts",
    "start": "node --env-file=../../.env dist/index.js",
    "clean": "rm -rf dist",
    "test": "vitest",
    "lint": "biome lint src/",
    "format": "biome format --write src/",
    "check": "biome check --write src/"
  },
  "dependencies": {
    "@gh-automation/logger": "workspace:*",
    "@gh-automation/nats": "workspace:*",
    "@gh-automation/shared-types": "workspace:*",
    "execa": "^9.5.2"
  },
  "devDependencies": {
    "@gh-automation/typescript-config": "workspace:*",
    "@types/node": "^20.11.19",
    "tsx": "^4.7.1",
    "typescript": "^5.3.3",
    "vitest": "^1.3.1"
  }
}
```

**Step 2: Создать `tsconfig.json`**

```json
{
  "extends": "@gh-automation/typescript-config/app.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Создать `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

**Step 4: Install dependencies**

Run: `pnpm install`
Expected: SUCCESS (lockfile обновлён, все workspace deps резолвятся)

**Step 5: Verify build (пустой проект)**

Run: `pnpm --filter @gh-automation/claude-job-runner build`
Expected: Может упасть (нет src/), это ОК — будет работать после Task 2.

**Step 6: Commit**

```bash
git add apps/claude-job-runner/package.json apps/claude-job-runner/tsconfig.json apps/claude-job-runner/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(claude-job-runner): scaffold package.json, tsconfig, vitest config"
```

---

## Task 2: Config — парсинг environment variables

**Files:**
- Create: `apps/claude-job-runner/src/config.ts`
- Create: `apps/claude-job-runner/src/__tests__/config.test.ts`

**Step 1: Создать `config.ts`**

```typescript
import type { Logger } from '@gh-automation/logger';

export interface RunnerConfig {
  natsUrl: string;
  consumerName: string;
  ackWaitMs: number;
  cloneBaseDir: string;
  cacheBaseDir: string;
  logLevel: string;
  maxConcurrentJobs: number;
}

const parsePositiveInt = (
  value: string | undefined,
  fallback: number,
  name: string,
  logger: Logger
): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn({ value, fallback }, `Invalid ${name}; using default`);
    return fallback;
  }
  return parsed;
};

export function loadConfig(logger: Logger): RunnerConfig {
  const natsUrl = process.env.NATS_URL || '';
  if (!natsUrl) {
    logger.warn('NATS_URL not set');
  }

  return {
    natsUrl,
    consumerName: process.env.NATS_CONSUMER_NAME || 'claude-job-runner',
    ackWaitMs: parsePositiveInt(process.env.NATS_ACK_WAIT_MS, 900_000, 'NATS_ACK_WAIT_MS', logger),
    cloneBaseDir: process.env.CLONE_BASE_DIR || '/tmp/claude-jobs',
    cacheBaseDir: process.env.CACHE_BASE_DIR || '/data/cache',
    logLevel: process.env.LOG_LEVEL || 'info',
    maxConcurrentJobs: parsePositiveInt(
      process.env.MAX_CONCURRENT_JOBS,
      1,
      'MAX_CONCURRENT_JOBS',
      logger
    ),
  };
}
```

**Step 2: Создать `config.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
});

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return defaults when no env vars set', () => {
    delete process.env.NATS_URL;
    delete process.env.NATS_CONSUMER_NAME;
    delete process.env.NATS_ACK_WAIT_MS;
    delete process.env.CLONE_BASE_DIR;
    delete process.env.CACHE_BASE_DIR;
    delete process.env.MAX_CONCURRENT_JOBS;

    const logger = createMockLogger();
    const config = loadConfig(logger as any);

    expect(config.natsUrl).toBe('');
    expect(config.consumerName).toBe('claude-job-runner');
    expect(config.ackWaitMs).toBe(900_000);
    expect(config.cloneBaseDir).toBe('/tmp/claude-jobs');
    expect(config.cacheBaseDir).toBe('/data/cache');
    expect(config.maxConcurrentJobs).toBe(1);
  });

  it('should parse env vars correctly', () => {
    process.env.NATS_URL = 'nats://custom:4222';
    process.env.NATS_CONSUMER_NAME = 'my-runner';
    process.env.NATS_ACK_WAIT_MS = '600000';
    process.env.CLONE_BASE_DIR = '/custom/clone';
    process.env.CACHE_BASE_DIR = '/custom/cache';
    process.env.MAX_CONCURRENT_JOBS = '3';

    const logger = createMockLogger();
    const config = loadConfig(logger as any);

    expect(config.natsUrl).toBe('nats://custom:4222');
    expect(config.consumerName).toBe('my-runner');
    expect(config.ackWaitMs).toBe(600_000);
    expect(config.cloneBaseDir).toBe('/custom/clone');
    expect(config.cacheBaseDir).toBe('/custom/cache');
    expect(config.maxConcurrentJobs).toBe(3);
  });

  it('should warn and use defaults for invalid numeric values', () => {
    process.env.NATS_ACK_WAIT_MS = 'not-a-number';
    process.env.MAX_CONCURRENT_JOBS = '-5';

    const logger = createMockLogger();
    const config = loadConfig(logger as any);

    expect(config.ackWaitMs).toBe(900_000);
    expect(config.maxConcurrentJobs).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(2); // NATS_URL warn не считаем — оно тоже вызовет warn
  });

  it('should warn when NATS_URL not set', () => {
    delete process.env.NATS_URL;

    const logger = createMockLogger();
    loadConfig(logger as any);

    expect(logger.warn).toHaveBeenCalledWith('NATS_URL not set');
  });
});
```

**Step 3: Verify**

Run: `pnpm --filter @gh-automation/claude-job-runner build && pnpm --filter @gh-automation/claude-job-runner test run`
Expected: BUILD SUCCESS, 4 tests PASS

**Step 4: Commit**

```bash
git add apps/claude-job-runner/src/config.ts apps/claude-job-runner/src/__tests__/config.test.ts
git commit -m "feat(claude-job-runner): add config module with env parsing"
```

---

## Task 3: CloneManager — git clone, cleanup, cache

**Files:**
- Create: `apps/claude-job-runner/src/clone-manager.ts`
- Create: `apps/claude-job-runner/src/__tests__/clone-manager.test.ts`

**Step 1: Создать `clone-manager.ts`**

```typescript
import { execa } from 'execa';
import { mkdir, rm, cp, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@gh-automation/logger';
import type { ClaudeJobRequest } from '@gh-automation/shared-types';

export class CloneManager {
  constructor(
    private readonly baseDir: string,
    private readonly cacheBaseDir: string,
    private readonly logger: Logger
  ) {}

  /**
   * Builds the clone directory path for a job.
   */
  getClonePath(jobId: string): string {
    return join(this.baseDir, `job-${jobId}`);
  }

  /**
   * Builds git clone CLI arguments from repository config.
   */
  buildCloneArgs(repo: ClaudeJobRequest['repository'], destPath: string): string[] {
    const args = ['clone'];

    if (repo.branch) {
      args.push('--branch', repo.branch);
    }

    if (repo.cloneDepth && repo.cloneDepth > 0) {
      args.push('--depth', String(repo.cloneDepth));
    }

    args.push(repo.url, destPath);
    return args;
  }

  /**
   * Clones the repository into a job-specific directory.
   * Returns the path to the cloned repo.
   */
  async clone(jobId: string, repo: ClaudeJobRequest['repository']): Promise<string> {
    const clonePath = this.getClonePath(jobId);

    await mkdir(clonePath, { recursive: true });

    const args = this.buildCloneArgs(repo, clonePath);

    this.logger.info({ jobId, url: repo.url, branch: repo.branch }, 'Cloning repository');

    await execa('git', args, { timeout: 120_000 });

    this.logger.info({ jobId, clonePath }, 'Repository cloned');
    return clonePath;
  }

  /**
   * Removes the clone directory.
   */
  async cleanup(clonePath: string): Promise<void> {
    try {
      await rm(clonePath, { recursive: true, force: true });
      this.logger.debug({ clonePath }, 'Clone directory cleaned up');
    } catch (error) {
      this.logger.warn({ clonePath, error }, 'Failed to cleanup clone directory');
    }
  }

  /**
   * Builds the cache key path for a job.
   * Cache is keyed by aggregateId (e.g. "owner/repo:42") to persist across job runs.
   */
  getCachePath(aggregateId: string): string {
    // Sanitize aggregateId for filesystem: replace / and : with _
    const sanitized = aggregateId.replace(/[/:]/g, '_');
    return join(this.cacheBaseDir, sanitized);
  }

  /**
   * Restores cached paths from cache directory into the clone.
   */
  async restoreCache(
    clonePath: string,
    aggregateId: string,
    cachePaths: string[]
  ): Promise<void> {
    const cacheSrcDir = this.getCachePath(aggregateId);

    for (const relativePath of cachePaths) {
      const src = join(cacheSrcDir, relativePath);
      const dest = join(clonePath, relativePath);

      try {
        await access(src);
        await mkdir(join(dest, '..'), { recursive: true });
        await cp(src, dest, { recursive: true });
        this.logger.debug({ src, dest }, 'Cache restored');
      } catch {
        this.logger.debug({ src }, 'Cache path not found, skipping');
      }
    }
  }

  /**
   * Saves cached paths from clone to cache directory for future runs.
   */
  async saveCache(
    clonePath: string,
    aggregateId: string,
    cachePaths: string[]
  ): Promise<void> {
    const cacheDestDir = this.getCachePath(aggregateId);

    for (const relativePath of cachePaths) {
      const src = join(clonePath, relativePath);
      const dest = join(cacheDestDir, relativePath);

      try {
        await access(src);
        await mkdir(join(dest, '..'), { recursive: true });
        await cp(src, dest, { recursive: true });
        this.logger.debug({ src, dest }, 'Cache saved');
      } catch {
        this.logger.debug({ src }, 'Cache source not found, skipping');
      }
    }
  }
}
```

**Step 2: Создать `clone-manager.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloneManager } from '../clone-manager.js';

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
});

describe('CloneManager', () => {
  let manager: CloneManager;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    manager = new CloneManager('/tmp/clone', '/data/cache', logger as any);
  });

  describe('getClonePath', () => {
    it('should build correct clone path from jobId', () => {
      expect(manager.getClonePath('abc-123')).toBe('/tmp/clone/job-abc-123');
    });
  });

  describe('buildCloneArgs', () => {
    it('should build basic clone args with url only', () => {
      const args = manager.buildCloneArgs(
        { url: 'https://github.com/owner/repo.git' },
        '/tmp/clone/job-1'
      );
      expect(args).toEqual(['clone', 'https://github.com/owner/repo.git', '/tmp/clone/job-1']);
    });

    it('should include --branch when specified', () => {
      const args = manager.buildCloneArgs(
        { url: 'https://github.com/owner/repo.git', branch: 'feature/test' },
        '/tmp/clone/job-1'
      );
      expect(args).toEqual([
        'clone',
        '--branch',
        'feature/test',
        'https://github.com/owner/repo.git',
        '/tmp/clone/job-1',
      ]);
    });

    it('should include --depth when specified and > 0', () => {
      const args = manager.buildCloneArgs(
        { url: 'https://github.com/owner/repo.git', cloneDepth: 1 },
        '/tmp/clone/job-1'
      );
      expect(args).toEqual([
        'clone',
        '--depth',
        '1',
        'https://github.com/owner/repo.git',
        '/tmp/clone/job-1',
      ]);
    });

    it('should not include --depth when 0', () => {
      const args = manager.buildCloneArgs(
        { url: 'https://github.com/owner/repo.git', cloneDepth: 0 },
        '/tmp/clone/job-1'
      );
      expect(args).toEqual(['clone', 'https://github.com/owner/repo.git', '/tmp/clone/job-1']);
    });

    it('should combine branch and depth', () => {
      const args = manager.buildCloneArgs(
        { url: 'https://github.com/owner/repo.git', branch: 'main', cloneDepth: 10 },
        '/tmp/clone/job-1'
      );
      expect(args).toEqual([
        'clone',
        '--branch',
        'main',
        '--depth',
        '10',
        'https://github.com/owner/repo.git',
        '/tmp/clone/job-1',
      ]);
    });
  });

  describe('getCachePath', () => {
    it('should sanitize aggregateId for filesystem path', () => {
      expect(manager.getCachePath('owner/repo:42')).toBe('/data/cache/owner_repo_42');
    });

    it('should handle aggregateId without special chars', () => {
      expect(manager.getCachePath('simple-key')).toBe('/data/cache/simple-key');
    });
  });
});
```

**Step 3: Verify**

Run: `pnpm --filter @gh-automation/claude-job-runner build && pnpm --filter @gh-automation/claude-job-runner test run`
Expected: BUILD SUCCESS, 7 tests PASS

**Step 4: Commit**

```bash
git add apps/claude-job-runner/src/clone-manager.ts apps/claude-job-runner/src/__tests__/clone-manager.test.ts
git commit -m "feat(claude-job-runner): add CloneManager with git clone, cleanup, cache"
```

---

## Task 4: ClaudeConfigBuilder — CLI args + MCP config

**Files:**
- Create: `apps/claude-job-runner/src/claude-config-builder.ts`
- Create: `apps/claude-job-runner/src/__tests__/claude-config-builder.test.ts`

**Step 1: Создать `claude-config-builder.ts`**

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeJobRequest, McpServerConfig } from '@gh-automation/shared-types';

export class ClaudeConfigBuilder {
  /**
   * Builds CLI arguments for `claude -p` from job request config.
   */
  buildArgs(config: ClaudeJobRequest['claude']): string[] {
    const args: string[] = ['-p', '--output-format', 'json'];

    if (config.model) {
      args.push('--model', config.model);
    }

    if (config.maxTurns) {
      args.push('--max-turns', String(config.maxTurns));
    }

    if (config.maxBudgetUsd) {
      args.push('--max-budget-usd', String(config.maxBudgetUsd));
    }

    if (config.allowedTools && config.allowedTools.length > 0) {
      args.push('--allowedTools', config.allowedTools.join(','));
    }

    if (config.permissionMode) {
      args.push('--permission-mode', config.permissionMode);
    }

    return args;
  }

  /**
   * Generates a temporary MCP config JSON file for the Claude session.
   * Includes the job-comm MCP server (for send_notification, ask_user, etc.)
   * plus any extra MCP servers from the job request.
   *
   * Returns the path to the generated config file.
   */
  async buildMcpConfig(options: {
    jobId: string;
    jobType: string;
    commMcpCommand: string;
    commMcpArgs?: string[];
    natsUrl: string;
    extraServers?: Record<string, McpServerConfig>;
    configDir: string;
  }): Promise<string> {
    const { jobId, jobType, commMcpCommand, commMcpArgs, natsUrl, extraServers, configDir } =
      options;

    const mcpConfig: Record<string, McpServerConfig> = {};

    // Add comm MCP server (notification, ask_user, progress)
    mcpConfig['job-comm'] = {
      command: commMcpCommand,
      args: commMcpArgs,
      env: {
        NATS_URL: natsUrl,
        JOB_ID: jobId,
        JOB_TYPE: jobType,
      },
    };

    // Add extra MCP servers from job request
    if (extraServers) {
      for (const [name, config] of Object.entries(extraServers)) {
        mcpConfig[name] = config;
      }
    }

    const configContent = JSON.stringify({ mcpServers: mcpConfig }, null, 2);
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, '.mcp.json');
    await writeFile(configPath, configContent, 'utf-8');

    return configPath;
  }
}
```

**Step 2: Создать `claude-config-builder.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeConfigBuilder } from '../claude-config-builder.js';

describe('ClaudeConfigBuilder', () => {
  let builder: ClaudeConfigBuilder;

  beforeEach(() => {
    builder = new ClaudeConfigBuilder();
  });

  describe('buildArgs', () => {
    it('should return base args with empty config', () => {
      const args = builder.buildArgs({});
      expect(args).toEqual(['-p', '--output-format', 'json']);
    });

    it('should include --model when specified', () => {
      const args = builder.buildArgs({ model: 'sonnet' });
      expect(args).toContain('--model');
      expect(args).toContain('sonnet');
    });

    it('should include --max-turns when specified', () => {
      const args = builder.buildArgs({ maxTurns: 50 });
      expect(args).toContain('--max-turns');
      expect(args).toContain('50');
    });

    it('should include --max-budget-usd when specified', () => {
      const args = builder.buildArgs({ maxBudgetUsd: 5 });
      expect(args).toContain('--max-budget-usd');
      expect(args).toContain('5');
    });

    it('should include --allowedTools as comma-separated string', () => {
      const args = builder.buildArgs({
        allowedTools: ['Edit', 'Write', 'Bash(git:*)'],
      });
      expect(args).toContain('--allowedTools');
      expect(args).toContain('Edit,Write,Bash(git:*)');
    });

    it('should not include --allowedTools when array is empty', () => {
      const args = builder.buildArgs({ allowedTools: [] });
      expect(args).not.toContain('--allowedTools');
    });

    it('should include --permission-mode when specified', () => {
      const args = builder.buildArgs({ permissionMode: 'bypassPermissions' });
      expect(args).toContain('--permission-mode');
      expect(args).toContain('bypassPermissions');
    });

    it('should combine all options', () => {
      const args = builder.buildArgs({
        model: 'opus',
        maxTurns: 100,
        maxBudgetUsd: 10,
        allowedTools: ['Edit', 'Write'],
        permissionMode: 'bypassPermissions',
      });

      expect(args).toEqual([
        '-p',
        '--output-format',
        'json',
        '--model',
        'opus',
        '--max-turns',
        '100',
        '--max-budget-usd',
        '10',
        '--allowedTools',
        'Edit,Write',
        '--permission-mode',
        'bypassPermissions',
      ]);
    });
  });
});
```

**Note:** `buildMcpConfig` записывает файлы — тест для него будет интеграционным (или с моками fs). В unit-тестах тестируем `buildArgs`, для `buildMcpConfig` достаточно e2e проверки через `job-executor.test.ts`.

**Step 3: Verify**

Run: `pnpm --filter @gh-automation/claude-job-runner build && pnpm --filter @gh-automation/claude-job-runner test run`
Expected: BUILD SUCCESS, all tests PASS

**Step 4: Commit**

```bash
git add apps/claude-job-runner/src/claude-config-builder.ts apps/claude-job-runner/src/__tests__/claude-config-builder.test.ts
git commit -m "feat(claude-job-runner): add ClaudeConfigBuilder for CLI args and MCP config"
```

---

## Task 5: ClaudeRunner — запуск Claude CLI

**Files:**
- Create: `apps/claude-job-runner/src/claude-runner.ts`
- Create: `apps/claude-job-runner/src/__tests__/claude-runner.test.ts`

**Step 1: Создать `claude-runner.ts`**

```typescript
import { execa } from 'execa';
import type { Logger } from '@gh-automation/logger';

export interface ClaudeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class ClaudeRunner {
  constructor(private readonly logger: Logger) {}

  /**
   * Runs `claude` CLI with given arguments in the specified directory.
   *
   * @param prompt - The prompt text to send via stdin
   * @param cwd - Working directory (clone path)
   * @param args - CLI arguments (from ClaudeConfigBuilder.buildArgs)
   * @param timeoutMs - Max execution time (default: 10 minutes)
   * @returns ClaudeResult with exit code, stdout, stderr
   */
  async run(
    prompt: string,
    cwd: string,
    args: string[],
    timeoutMs = 600_000
  ): Promise<ClaudeResult> {
    this.logger.info(
      { cwd, argsCount: args.length, timeoutMs },
      'Starting Claude CLI'
    );

    try {
      const result = await execa('claude', args, {
        cwd,
        input: prompt,
        timeout: timeoutMs,
        reject: false, // Don't throw on non-zero exit code
      });

      this.logger.info(
        { exitCode: result.exitCode, stdoutLength: result.stdout.length },
        'Claude CLI finished'
      );

      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      // Timeout or other system error (not Claude exit code)
      if (error instanceof Error && error.message.includes('timed out')) {
        this.logger.error({ timeoutMs }, 'Claude CLI timed out');
        return {
          exitCode: -1,
          stdout: '',
          stderr: `Process timed out after ${timeoutMs}ms`,
        };
      }
      throw error;
    }
  }
}
```

**Step 2: Создать `claude-runner.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeRunner } from '../claude-runner.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
});

describe('ClaudeRunner', () => {
  let runner: ClaudeRunner;
  let logger: ReturnType<typeof createMockLogger>;
  let mockExeca: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    logger = createMockLogger();
    runner = new ClaudeRunner(logger as any);
    const execaMod = await import('execa');
    mockExeca = execaMod.execa as unknown as ReturnType<typeof vi.fn>;
    mockExeca.mockReset();
  });

  it('should call execa with correct arguments', async () => {
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: '{"result": "done"}',
      stderr: '',
    });

    await runner.run('Fix the bug', '/tmp/clone', ['-p', '--model', 'sonnet'], 300_000);

    expect(mockExeca).toHaveBeenCalledWith(
      'claude',
      ['-p', '--model', 'sonnet'],
      expect.objectContaining({
        cwd: '/tmp/clone',
        input: 'Fix the bug',
        timeout: 300_000,
        reject: false,
      })
    );
  });

  it('should return ClaudeResult with exit code, stdout, stderr', async () => {
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: 'output text',
      stderr: 'some warnings',
    });

    const result = await runner.run('prompt', '/tmp/clone', ['-p']);

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'output text',
      stderr: 'some warnings',
    });
  });

  it('should handle non-zero exit code without throwing', async () => {
    mockExeca.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'Error occurred',
    });

    const result = await runner.run('prompt', '/tmp/clone', ['-p']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Error occurred');
  });

  it('should handle timeout gracefully', async () => {
    mockExeca.mockRejectedValue(new Error('timed out after 5000 milliseconds'));

    const result = await runner.run('prompt', '/tmp/clone', ['-p'], 5000);

    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('timed out');
  });

  it('should re-throw non-timeout errors', async () => {
    mockExeca.mockRejectedValue(new Error('ENOENT: claude not found'));

    await expect(runner.run('prompt', '/tmp/clone', ['-p'])).rejects.toThrow(
      'ENOENT: claude not found'
    );
  });
});
```

**Step 3: Verify**

Run: `pnpm --filter @gh-automation/claude-job-runner build && pnpm --filter @gh-automation/claude-job-runner test run`
Expected: BUILD SUCCESS, all tests PASS

**Step 4: Commit**

```bash
git add apps/claude-job-runner/src/claude-runner.ts apps/claude-job-runner/src/__tests__/claude-runner.test.ts
git commit -m "feat(claude-job-runner): add ClaudeRunner for Claude CLI invocation"
```

---

## Task 6: JobConsumer — NATS consumer loop с heartbeat

**Files:**
- Create: `apps/claude-job-runner/src/job-consumer.ts`
- Create: `apps/claude-job-runner/src/__tests__/job-consumer.test.ts`

**Step 1: Создать `job-consumer.ts`**

```typescript
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
```

**Step 2: Создать `job-consumer.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobConsumer } from '../job-consumer.js';

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
});

const createMockSubscriber = () => ({
  ensureConsumer: vi.fn(),
  getConsumer: vi.fn(),
});

const createMockMsg = (data: unknown) => ({
  string: () => JSON.stringify(data),
  subject: 'claude.job.request.pr-review',
  ack: vi.fn(),
  nak: vi.fn(),
  working: vi.fn(),
});

describe('JobConsumer', () => {
  let consumer: JobConsumer;
  let mockSubscriber: ReturnType<typeof createMockSubscriber>;
  let logger: ReturnType<typeof createMockLogger>;

  const config = {
    consumerName: 'claude-job-runner',
    ackWaitMs: 900_000,
    filterSubject: 'claude.job.request.>',
  };

  beforeEach(() => {
    mockSubscriber = createMockSubscriber();
    logger = createMockLogger();
    consumer = new JobConsumer(mockSubscriber as any, logger as any, config);
  });

  describe('init', () => {
    it('should call ensureConsumer with correct config', async () => {
      await consumer.init();

      expect(mockSubscriber.ensureConsumer).toHaveBeenCalledWith('claude-job-runner', {
        ackWaitMs: 900_000,
        filterSubject: 'claude.job.request.>',
      });
    });
  });

  describe('parseMessage', () => {
    it('should parse valid PublishableEvent with ClaudeJobRequest payload', () => {
      const msg = createMockMsg({
        eventId: 'evt-1',
        eventType: 'claude.job.request.pr-review',
        payload: {
          jobId: 'job-1',
          jobType: 'pr-review',
          prompt: 'Review this PR',
          repository: { url: 'https://github.com/owner/repo.git' },
          claude: {},
          communication: { enableNotifications: true, enableAskUser: false },
          metadata: {},
          createdAt: '2026-01-01T00:00:00Z',
        },
      });

      const result = consumer.parseMessage(msg as any);

      expect(result).not.toBeNull();
      expect(result!.jobId).toBe('job-1');
      expect(result!.prompt).toBe('Review this PR');
    });

    it('should return null for invalid JSON', () => {
      const msg = {
        string: () => 'not json',
        subject: 'claude.job.request.pr-review',
      };

      const result = consumer.parseMessage(msg as any);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should return null for message without required fields', () => {
      const msg = createMockMsg({
        payload: { jobId: 'job-1' }, // missing jobType and prompt
      });

      const result = consumer.parseMessage(msg as any);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should return null for message with empty payload', () => {
      const msg = createMockMsg({ payload: {} });

      const result = consumer.parseMessage(msg as any);

      expect(result).toBeNull();
    });
  });
});
```

**Step 3: Verify**

Run: `pnpm --filter @gh-automation/claude-job-runner build && pnpm --filter @gh-automation/claude-job-runner test run`
Expected: BUILD SUCCESS, all tests PASS

**Step 4: Commit**

```bash
git add apps/claude-job-runner/src/job-consumer.ts apps/claude-job-runner/src/__tests__/job-consumer.test.ts
git commit -m "feat(claude-job-runner): add JobConsumer with NATS consumer loop and heartbeat"
```

---

## Task 7: JobExecutor — оркестратор job pipeline

**Files:**
- Create: `apps/claude-job-runner/src/job-executor.ts`
- Create: `apps/claude-job-runner/src/__tests__/job-executor.test.ts`

**Step 1: Создать `job-executor.ts`**

```typescript
import type { Logger } from '@gh-automation/logger';
import type { NatsPublisher, PublishableEvent } from '@gh-automation/nats';
import type { ClaudeJobRequest, ClaudeJobResult } from '@gh-automation/shared-types';
import type { ClaudeConfigBuilder } from './claude-config-builder.js';
import type { ClaudeRunner, ClaudeResult } from './claude-runner.js';
import type { CloneManager } from './clone-manager.js';

export interface JobExecutorDeps {
  cloneManager: CloneManager;
  claudeRunner: ClaudeRunner;
  configBuilder: ClaudeConfigBuilder;
  publisher: NatsPublisher;
  logger: Logger;
  natsUrl: string;
}

export class JobExecutor {
  private readonly cloneManager: CloneManager;
  private readonly claudeRunner: ClaudeRunner;
  private readonly configBuilder: ClaudeConfigBuilder;
  private readonly publisher: NatsPublisher;
  private readonly logger: Logger;
  private readonly natsUrl: string;

  constructor(deps: JobExecutorDeps) {
    this.cloneManager = deps.cloneManager;
    this.claudeRunner = deps.claudeRunner;
    this.configBuilder = deps.configBuilder;
    this.publisher = deps.publisher;
    this.logger = deps.logger;
    this.natsUrl = deps.natsUrl;
  }

  /**
   * Executes a complete job pipeline:
   * 1. Clone repo
   * 2. Restore cache
   * 3. Build Claude CLI args + MCP config
   * 4. Run Claude
   * 5. Save cache
   * 6. Publish result to NATS
   * 7. Cleanup clone (always)
   */
  async execute(request: ClaudeJobRequest): Promise<ClaudeJobResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    let clonePath: string | null = null;

    try {
      // 1. Clone
      clonePath = await this.cloneManager.clone(request.jobId, request.repository);

      // 2. Restore cache
      if (request.cache?.paths?.length) {
        const aggregateId = `${request.metadata.repository}:${request.metadata.prNumber}`;
        await this.cloneManager.restoreCache(
          clonePath,
          String(aggregateId),
          request.cache.paths
        );
      }

      // 3. Build config
      const args = this.configBuilder.buildArgs(request.claude);

      if (request.communication.enableNotifications || request.communication.enableAskUser) {
        await this.configBuilder.buildMcpConfig({
          jobId: request.jobId,
          jobType: request.jobType,
          commMcpCommand: 'node',
          commMcpArgs: ['/app/apps/claude-job-runner/dist/mcp-server/index.js'],
          natsUrl: this.natsUrl,
          extraServers: request.claude.mcpServers,
          configDir: clonePath,
        });
      }

      // 4. Run Claude
      const timeoutMs = request.claude.timeoutMs ?? 600_000;
      const claudeResult = await this.claudeRunner.run(
        request.prompt,
        clonePath,
        args,
        timeoutMs
      );

      // 5. Save cache
      if (request.cache?.paths?.length && clonePath) {
        const aggregateId = `${request.metadata.repository}:${request.metadata.prNumber}`;
        await this.cloneManager.saveCache(
          clonePath,
          String(aggregateId),
          request.cache.paths
        );
      }

      // 6. Build result
      const result = this.buildResult(request, claudeResult, startedAt, startTime);

      // 7. Publish result
      await this.publishResult(request, result);

      return result;
    } catch (error) {
      const errorResult = this.buildErrorResult(
        request,
        error as Error,
        startedAt,
        startTime
      );

      await this.publishResult(request, errorResult);

      return errorResult;
    } finally {
      // 8. Cleanup
      if (clonePath) {
        await this.cloneManager.cleanup(clonePath);
      }
    }
  }

  private buildResult(
    request: ClaudeJobRequest,
    claudeResult: ClaudeResult,
    startedAt: string,
    startTime: number
  ): ClaudeJobResult {
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    if (claudeResult.exitCode === -1) {
      return {
        jobId: request.jobId,
        jobType: request.jobType,
        status: 'timeout',
        error: { message: claudeResult.stderr, exitCode: -1 },
        timing: { startedAt, completedAt, durationMs },
        metadata: request.metadata,
      };
    }

    if (claudeResult.exitCode !== 0) {
      return {
        jobId: request.jobId,
        jobType: request.jobType,
        status: 'failed',
        error: {
          message: claudeResult.stderr || 'Claude exited with non-zero code',
          exitCode: claudeResult.exitCode,
        },
        timing: { startedAt, completedAt, durationMs },
        metadata: request.metadata,
      };
    }

    return {
      jobId: request.jobId,
      jobType: request.jobType,
      status: 'completed',
      result: {
        summary: this.extractSummary(claudeResult.stdout),
        output: claudeResult.stdout,
        exitCode: 0,
      },
      timing: { startedAt, completedAt, durationMs },
      metadata: request.metadata,
    };
  }

  private buildErrorResult(
    request: ClaudeJobRequest,
    error: Error,
    startedAt: string,
    startTime: number
  ): ClaudeJobResult {
    return {
      jobId: request.jobId,
      jobType: request.jobType,
      status: 'failed',
      error: { message: error.message },
      timing: {
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
      metadata: request.metadata,
    };
  }

  private extractSummary(stdout: string): string {
    // Try to parse JSON output from Claude
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.result) return String(parsed.result).slice(0, 500);
    } catch {
      // Not JSON, use raw output
    }
    return stdout.slice(0, 500);
  }

  private async publishResult(
    request: ClaudeJobRequest,
    result: ClaudeJobResult
  ): Promise<void> {
    const event: PublishableEvent = {
      eventId: `result-${request.jobId}`,
      eventType: `claude.job.result.${request.jobType}`,
      aggregateId: request.jobId,
      payload: result,
      metadata: {
        jobType: request.jobType,
        status: result.status,
      },
    };

    try {
      await this.publisher.publish(event);
      this.logger.info(
        { jobId: request.jobId, status: result.status },
        'Job result published'
      );
    } catch (error) {
      this.logger.error(
        { jobId: request.jobId, error },
        'Failed to publish job result'
      );
    }
  }
}
```

**Step 2: Создать `job-executor.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobExecutor } from '../job-executor.js';
import type { ClaudeJobRequest } from '@gh-automation/shared-types';
import { JobType } from '@gh-automation/shared-types';

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
});

const createMockCloneManager = () => ({
  clone: vi.fn().mockResolvedValue('/tmp/clone/job-test-1'),
  cleanup: vi.fn().mockResolvedValue(undefined),
  restoreCache: vi.fn().mockResolvedValue(undefined),
  saveCache: vi.fn().mockResolvedValue(undefined),
});

const createMockClaudeRunner = () => ({
  run: vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: '{"result": "All done"}',
    stderr: '',
  }),
});

const createMockConfigBuilder = () => ({
  buildArgs: vi.fn().mockReturnValue(['-p', '--output-format', 'json', '--model', 'sonnet']),
  buildMcpConfig: vi.fn().mockResolvedValue('/tmp/clone/job-test-1/.mcp.json'),
});

const createMockPublisher = () => ({
  publish: vi.fn().mockResolvedValue(undefined),
  ensureStream: vi.fn().mockResolvedValue(undefined),
});

const createTestRequest = (overrides?: Partial<ClaudeJobRequest>): ClaudeJobRequest => ({
  jobId: 'test-job-1',
  jobType: JobType.PR_REVIEW,
  prompt: 'Review this PR',
  repository: {
    url: 'https://github.com/owner/repo.git',
    branch: 'feature/test',
  },
  claude: {
    model: 'sonnet',
    maxTurns: 50,
    timeoutMs: 300_000,
  },
  communication: {
    enableNotifications: true,
    enableAskUser: false,
  },
  metadata: {
    repository: 'owner/repo',
    prNumber: 42,
  },
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('JobExecutor', () => {
  let executor: JobExecutor;
  let mocks: {
    cloneManager: ReturnType<typeof createMockCloneManager>;
    claudeRunner: ReturnType<typeof createMockClaudeRunner>;
    configBuilder: ReturnType<typeof createMockConfigBuilder>;
    publisher: ReturnType<typeof createMockPublisher>;
    logger: ReturnType<typeof createMockLogger>;
  };

  beforeEach(() => {
    mocks = {
      cloneManager: createMockCloneManager(),
      claudeRunner: createMockClaudeRunner(),
      configBuilder: createMockConfigBuilder(),
      publisher: createMockPublisher(),
      logger: createMockLogger(),
    };

    executor = new JobExecutor({
      ...mocks,
      natsUrl: 'nats://localhost:4222',
    } as any);
  });

  it('should execute full pipeline: clone -> configure -> run -> publish -> cleanup', async () => {
    const request = createTestRequest();

    const result = await executor.execute(request);

    // 1. Clone
    expect(mocks.cloneManager.clone).toHaveBeenCalledWith('test-job-1', request.repository);

    // 2. Build args
    expect(mocks.configBuilder.buildArgs).toHaveBeenCalledWith(request.claude);

    // 3. Build MCP config (enableNotifications = true)
    expect(mocks.configBuilder.buildMcpConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'test-job-1',
        jobType: 'pr-review',
      })
    );

    // 4. Run Claude
    expect(mocks.claudeRunner.run).toHaveBeenCalledWith(
      'Review this PR',
      '/tmp/clone/job-test-1',
      expect.any(Array),
      300_000
    );

    // 5. Publish result
    expect(mocks.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'claude.job.result.pr-review',
        aggregateId: 'test-job-1',
      })
    );

    // 6. Cleanup
    expect(mocks.cloneManager.cleanup).toHaveBeenCalledWith('/tmp/clone/job-test-1');

    // 7. Result
    expect(result.status).toBe('completed');
    expect(result.jobId).toBe('test-job-1');
  });

  it('should not build MCP config when communication is disabled', async () => {
    const request = createTestRequest({
      communication: { enableNotifications: false, enableAskUser: false },
    });

    await executor.execute(request);

    expect(mocks.configBuilder.buildMcpConfig).not.toHaveBeenCalled();
  });

  it('should return failed result when Claude exits with non-zero code', async () => {
    mocks.claudeRunner.run.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'Claude error',
    });

    const result = await executor.execute(createTestRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('Claude error');
    expect(result.error?.exitCode).toBe(1);
  });

  it('should return timeout result when Claude times out', async () => {
    mocks.claudeRunner.run.mockResolvedValue({
      exitCode: -1,
      stdout: '',
      stderr: 'Process timed out after 300000ms',
    });

    const result = await executor.execute(createTestRequest());

    expect(result.status).toBe('timeout');
    expect(result.error?.exitCode).toBe(-1);
  });

  it('should return failed result and still publish when clone fails', async () => {
    mocks.cloneManager.clone.mockRejectedValue(new Error('git clone failed'));

    const result = await executor.execute(createTestRequest());

    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('git clone failed');

    // Still publishes the error result
    expect(mocks.publisher.publish).toHaveBeenCalled();
  });

  it('should always cleanup even on failure', async () => {
    mocks.claudeRunner.run.mockRejectedValue(new Error('unexpected'));

    await executor.execute(createTestRequest());

    expect(mocks.cloneManager.cleanup).toHaveBeenCalledWith('/tmp/clone/job-test-1');
  });

  it('should handle cache restore and save', async () => {
    const request = createTestRequest({
      cache: { paths: ['.pr-threads-cache'] },
    });

    await executor.execute(request);

    expect(mocks.cloneManager.restoreCache).toHaveBeenCalledWith(
      '/tmp/clone/job-test-1',
      'owner/repo:42',
      ['.pr-threads-cache']
    );
    expect(mocks.cloneManager.saveCache).toHaveBeenCalledWith(
      '/tmp/clone/job-test-1',
      'owner/repo:42',
      ['.pr-threads-cache']
    );
  });

  it('should skip cache when not specified', async () => {
    const request = createTestRequest(); // no cache field

    await executor.execute(request);

    expect(mocks.cloneManager.restoreCache).not.toHaveBeenCalled();
    expect(mocks.cloneManager.saveCache).not.toHaveBeenCalled();
  });

  it('should include timing in result', async () => {
    const result = await executor.execute(createTestRequest());

    expect(result.timing.startedAt).toBeDefined();
    expect(result.timing.completedAt).toBeDefined();
    expect(result.timing.durationMs).toBeGreaterThanOrEqual(0);
  });
});
```

**Step 3: Verify**

Run: `pnpm --filter @gh-automation/claude-job-runner build && pnpm --filter @gh-automation/claude-job-runner test run`
Expected: BUILD SUCCESS, all tests PASS

**Step 4: Commit**

```bash
git add apps/claude-job-runner/src/job-executor.ts apps/claude-job-runner/src/__tests__/job-executor.test.ts
git commit -m "feat(claude-job-runner): add JobExecutor orchestrating clone -> claude -> publish"
```

---

## Task 8: Entry point — index.ts с lifecycle и shutdown

**Files:**
- Create: `apps/claude-job-runner/src/index.ts`

**Step 1: Создать `index.ts`**

```typescript
import { createLogger } from '@gh-automation/logger';
import {
  getNatsConnection,
  closeNatsConnection,
  createNatsPublisher,
  createNatsSubscriber,
  CLAUDE_JOBS_STREAM_CONFIG,
  CLAUDE_JOBS_STREAM_NAME,
} from '@gh-automation/nats';
import { loadConfig } from './config.js';
import { CloneManager } from './clone-manager.js';
import { ClaudeRunner } from './claude-runner.js';
import { ClaudeConfigBuilder } from './claude-config-builder.js';
import { JobConsumer } from './job-consumer.js';
import { JobExecutor } from './job-executor.js';

const logger = createLogger('claude-job-runner', '0.0.1');
const config = loadConfig(logger);

let isShuttingDown = false;
let jobConsumer: JobConsumer | null = null;

const initialize = async () => {
  if (!config.natsUrl) {
    throw new Error('NATS_URL is required');
  }

  // Connect to NATS
  const nc = await getNatsConnection({ url: config.natsUrl }, logger);

  // Create publisher for CLAUDE_JOBS (to publish results)
  const publisher = await createNatsPublisher(nc, logger, CLAUDE_JOBS_STREAM_CONFIG);

  // Create subscriber for CLAUDE_JOBS (to consume job requests)
  const subscriber = await createNatsSubscriber(nc, logger, CLAUDE_JOBS_STREAM_NAME);

  // Build components
  const cloneManager = new CloneManager(config.cloneBaseDir, config.cacheBaseDir, logger);
  const claudeRunner = new ClaudeRunner(logger);
  const configBuilder = new ClaudeConfigBuilder();

  const executor = new JobExecutor({
    cloneManager,
    claudeRunner,
    configBuilder,
    publisher,
    logger,
    natsUrl: config.natsUrl,
  });

  // Create consumer
  jobConsumer = new JobConsumer(subscriber, logger, {
    consumerName: config.consumerName,
    ackWaitMs: config.ackWaitMs,
    filterSubject: 'claude.job.request.>',
  });

  await jobConsumer.init();

  return jobConsumer;
};

const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Received shutdown signal');

  if (jobConsumer) {
    await jobConsumer.stop();
  }

  try {
    await closeNatsConnection(logger);
  } catch (error) {
    logger.warn({ error }, 'Failed to close NATS connection');
  }

  logger.info('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

initialize()
  .then(async (consumer) => {
    logger.info('Claude Job Runner started successfully');

    // Create executor inline since we need it as handler
    // The executor is already wired above; we pass its execute method
    const nc = await getNatsConnection({ url: config.natsUrl }, logger);
    const publisher = await createNatsPublisher(nc, logger, CLAUDE_JOBS_STREAM_CONFIG);
    const cloneManager = new CloneManager(config.cloneBaseDir, config.cacheBaseDir, logger);
    const claudeRunner = new ClaudeRunner(logger);
    const configBuilder = new ClaudeConfigBuilder();

    const executor = new JobExecutor({
      cloneManager,
      claudeRunner,
      configBuilder,
      publisher,
      logger,
      natsUrl: config.natsUrl,
    });

    await consumer.listen((request) => executor.execute(request));
  })
  .catch((error) => {
    logger.error({ error }, 'Fatal error during initialization');
    process.exit(1);
  });
```

**Important:** Этот index.ts имеет дублирование инициализации — executor создаётся дважды. Это **нужно рефакторить** в Step 2.

**Step 2: Рефакторинг index.ts (убрать дублирование)**

```typescript
import { createLogger } from '@gh-automation/logger';
import {
  getNatsConnection,
  closeNatsConnection,
  createNatsPublisher,
  createNatsSubscriber,
  CLAUDE_JOBS_STREAM_CONFIG,
  CLAUDE_JOBS_STREAM_NAME,
} from '@gh-automation/nats';
import { loadConfig } from './config.js';
import { CloneManager } from './clone-manager.js';
import { ClaudeRunner } from './claude-runner.js';
import { ClaudeConfigBuilder } from './claude-config-builder.js';
import { JobConsumer } from './job-consumer.js';
import { JobExecutor } from './job-executor.js';

const logger = createLogger('claude-job-runner', '0.0.1');
const config = loadConfig(logger);

let isShuttingDown = false;
let jobConsumer: JobConsumer | null = null;

const initialize = async () => {
  if (!config.natsUrl) {
    throw new Error('NATS_URL is required');
  }

  const nc = await getNatsConnection({ url: config.natsUrl }, logger);
  const publisher = await createNatsPublisher(nc, logger, CLAUDE_JOBS_STREAM_CONFIG);
  const subscriber = await createNatsSubscriber(nc, logger, CLAUDE_JOBS_STREAM_NAME);

  const cloneManager = new CloneManager(config.cloneBaseDir, config.cacheBaseDir, logger);
  const claudeRunner = new ClaudeRunner(logger);
  const configBuilder = new ClaudeConfigBuilder();

  const executor = new JobExecutor({
    cloneManager,
    claudeRunner,
    configBuilder,
    publisher,
    logger,
    natsUrl: config.natsUrl,
  });

  jobConsumer = new JobConsumer(subscriber, logger, {
    consumerName: config.consumerName,
    ackWaitMs: config.ackWaitMs,
    filterSubject: 'claude.job.request.>',
  });

  await jobConsumer.init();

  return { consumer: jobConsumer, executor };
};

const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Received shutdown signal');

  if (jobConsumer) {
    await jobConsumer.stop();
  }

  try {
    await closeNatsConnection(logger);
  } catch (error) {
    logger.warn({ error }, 'Failed to close NATS connection');
  }

  logger.info('Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

initialize()
  .then(async ({ consumer, executor }) => {
    logger.info('Claude Job Runner started successfully');
    await consumer.listen((request) => executor.execute(request));
  })
  .catch((error) => {
    logger.error({ error }, 'Fatal error during initialization');
    process.exit(1);
  });
```

**Step 3: Verify build**

Run: `pnpm --filter @gh-automation/claude-job-runner build`
Expected: BUILD SUCCESS

**Step 4: Commit**

```bash
git add apps/claude-job-runner/src/index.ts
git commit -m "feat(claude-job-runner): add entry point with NATS lifecycle and graceful shutdown"
```

---

## Task 9: Полная верификация

**Step 1: Собрать все пакеты**

Run: `pnpm build`
Expected: SUCCESS (все пакеты и apps собираются, Turborepo кеширует зависимости)

**Step 2: Прогнать все тесты claude-job-runner**

Run: `pnpm --filter @gh-automation/claude-job-runner test run`
Expected: ALL PASS

Ожидаемое количество тестов:
| Файл | Кол-во |
|------|--------|
| config.test.ts | 4 |
| clone-manager.test.ts | 7 |
| claude-config-builder.test.ts | 8 |
| claude-runner.test.ts | 5 |
| job-consumer.test.ts | 4 |
| job-executor.test.ts | 9 |
| **Итого** | **~37** |

**Step 3: Проверить backward compatibility**

Run: `pnpm --filter @gh-automation/nats test run`
Expected: ALL PASS (nats пакет не менялся)

Run: `pnpm --filter @gh-automation/event-processor-worker test run`
Expected: ALL PASS (event-processor-worker не затронут)

**Step 4: Финальный commit (если были фиксы)**

Если фиксов не было — пропускаем.

---

## Environment Variables

```bash
# Required
NATS_URL=nats://localhost:4222

# Optional (with defaults)
NATS_CONSUMER_NAME=claude-job-runner   # Durable consumer name
NATS_ACK_WAIT_MS=900000               # 15 min (Claude может работать долго)
CLONE_BASE_DIR=/tmp/claude-jobs        # Dir for git clones
CACHE_BASE_DIR=/data/cache             # Persistent cache dir (Docker volume)
MAX_CONCURRENT_JOBS=1                  # Job parallelism (1 for MVP)
LOG_LEVEL=info
```

---

## Чеклист готовности Task 1

- [ ] `apps/claude-job-runner/package.json` с правильными зависимостями
- [ ] `config.ts` парсит env vars с defaults и validation
- [ ] `CloneManager` — clone, cleanup, cache restore/save, unit-тестирован
- [ ] `ClaudeConfigBuilder` — buildArgs, buildMcpConfig, unit-тестирован
- [ ] `ClaudeRunner` — запуск `claude` через execa с timeout, unit-тестирован
- [ ] `JobConsumer` — NATS consumer loop с heartbeat (msg.working()), unit-тестирован
- [ ] `JobExecutor` — полный pipeline clone→claude→publish→cleanup, unit-тестирован
- [ ] `index.ts` — entry point с lifecycle, graceful shutdown
- [ ] `pnpm build` — все пакеты собираются
- [ ] `pnpm --filter @gh-automation/claude-job-runner test run` — ~37 тестов проходят
- [ ] Backward compatibility: event-processor-worker и nats тесты не сломаны

---

## Ручная верификация (после деплоя)

1. Запустить NATS: `docker-compose up -d nats`
2. Запустить runner: `pnpm --filter @gh-automation/claude-job-runner dev`
3. Опубликовать тестовый job request через `nats pub`:
   ```bash
   nats pub claude.job.request.pr-review '{"eventId":"test-1","eventType":"claude.job.request.pr-review","aggregateId":"test","payload":{"jobId":"manual-test-1","jobType":"pr-review","prompt":"echo hello","repository":{"url":"https://github.com/octocat/Hello-World.git"},"claude":{},"communication":{"enableNotifications":false,"enableAskUser":false},"metadata":{},"createdAt":"2026-01-01T00:00:00Z"}}'
   ```
4. Убедиться что runner подхватил, склонировал, попытался запустить claude (может упасть если claude CLI не установлен — это ОК для Task 1)
5. Проверить что result опубликован в `claude.job.result.pr-review`
