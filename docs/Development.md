# Development Guide

Руководство для разработчиков по работе с монорепо.

## Настройка окружения

### Требования

```bash
# Node.js 20+
node --version  # v20.x.x

# pnpm 9+
pnpm --version  # 9.x.x

# GitHub CLI
gh --version    # 2.x.x
gh auth status  # Должен быть авторизован

# PostgreSQL (опционально, можно через Docker)
psql --version  # 16.x

# Docker & Docker Compose (опционально)
docker --version
docker-compose --version
```

### Первый запуск

```bash
# 1. Клонировать репозиторий
git clone <repo-url>
cd gh-automation

# 2. Установить зависимости
pnpm install

# 3. Настроить .env
cp .env.example .env
# Отредактировать .env (добавить GH_TOKEN)

# 4. Запустить PostgreSQL
docker-compose up -d postgres

# 5. Применить миграции
pnpm --filter @gh-automation/database db:migrate

# 6. Проверить что всё работает
pnpm build
pnpm test
```

## Структура Turborepo

### Workspace пакеты

```
packages/
├── database/          # @gh-automation/database
├── shared-types/      # @gh-automation/shared-types
├── logger/            # @gh-automation/logger
└── config/
    ├── typescript-config/
    └── eslint-config/
```

### Приложения

```
apps/
├── github-notifications-collector/  # @gh-automation/github-notifications-collector
└── event-processor-worker/         # @gh-automation/event-processor-worker
```

### Задачи в turbo.json

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],  // Сначала зависимости
      "outputs": ["dist/**"]     // Кэшируем результат
    },
    "dev": {
      "cache": false,            // Не кэшируем dev
      "persistent": true         // Долгоживущий процесс
    },
    "lint": {},
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

## Работа с пакетами

### Добавить зависимость

```bash
# В конкретный пакет
pnpm --filter @gh-automation/database add drizzle-orm

# Dev зависимость
pnpm --filter @gh-automation/database add -D vitest

# Workspace зависимость
pnpm --filter @gh-automation/github-notifications-collector add @gh-automation/database@workspace:*
```

### Запустить команду

```bash
# В конкретном пакете
pnpm --filter @gh-automation/database build

# Во всех пакетах
pnpm build

# В нескольких пакетах (glob)
pnpm --filter "./packages/*" build
```

### Создать новый пакет

```bash
# 1. Создать директорию
mkdir -p packages/my-package

# 2. Создать package.json
cat > packages/my-package/package.json <<EOF
{
  "name": "@gh-automation/my-package",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "@gh-automation/typescript-config": "workspace:*",
    "typescript": "^5.3.3"
  }
}
EOF

# 3. Создать tsconfig.json
cat > packages/my-package/tsconfig.json <<EOF
{
  "extends": "@gh-automation/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
EOF

# 4. Создать src/index.ts
mkdir -p packages/my-package/src
echo "export const hello = 'world';" > packages/my-package/src/index.ts

# 5. Установить зависимости
pnpm install
```

## База данных

### Миграции с Drizzle

#### Создание миграции

```bash
# 1. Изменить schema в packages/database/src/schema/
# Например, добавить новое поле:

# packages/database/src/schema/notifications.schema.ts
export const githubNotifications = pgTable('github_notifications', {
  // ...
  newField: varchar('new_field', { length: 255 }),
});

# 2. Сгенерировать миграцию
pnpm --filter @gh-automation/database db:generate

# 3. Проверить сгенерированный SQL
cat packages/database/src/migrations/0001_*.sql

# 4. Применить миграцию
pnpm --filter @gh-automation/database db:migrate
```

#### Откат миграции

Drizzle не поддерживает автоматический rollback. Нужно:

```bash
# 1. Написать DOWN миграцию вручную
cat > packages/database/src/migrations/rollback_0001.sql <<EOF
ALTER TABLE github_notifications DROP COLUMN new_field;
EOF

# 2. Применить через psql
psql $DATABASE_URL < packages/database/src/migrations/rollback_0001.sql
```

#### Drizzle Studio

GUI для работы с БД:

```bash
pnpm --filter @gh-automation/database db:studio
# Открыть https://local.drizzle.studio
```

### Работа с PostgreSQL напрямую

```bash
# Подключиться к БД
psql postgresql://postgres:postgres@localhost:5432/gh_automation

# Полезные команды
\dt              # Список таблиц
\d table_name    # Схема таблицы
\di              # Индексы
\x               # Expanded display (для jsonb)

# Примеры запросов
SELECT * FROM github_notifications LIMIT 10;
SELECT COUNT(*), status FROM outbox_events GROUP BY status;
```

## Тестирование

### Запуск тестов

```bash
# Все тесты
pnpm test

# Только unit тесты
pnpm test --run

# С покрытием
pnpm test --coverage

# Watch mode
pnpm test --watch

# Конкретный файл
pnpm test gh-notify-parser.test.ts
```

### Написание тестов

```typescript
// src/my-module.test.ts
import { describe, it, expect } from 'vitest';
import { myFunction } from './my-module.js';

describe('myFunction', () => {
  it('should return expected value', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });
});
```

### Интеграционные тесты

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@gh-automation/database';

describe('Integration tests', () => {
  beforeAll(async () => {
    // Setup test database
  });

  afterAll(async () => {
    // Cleanup
    await db.close();
  });

  it('should save notification to database', async () => {
    // Test implementation
  });
});
```

## Debugging

### VSCode Launch Configuration

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Collector",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@gh-automation/github-notifications-collector", "dev"],
      "skipFiles": ["<node_internals>/**"],
      "env": {
        "DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/gh_automation"
      }
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["test", "--run"],
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

### Логирование

```typescript
import { createLogger } from '@gh-automation/logger';

const logger = createLogger('my-service');

logger.debug({ data }, 'Debug message');
logger.info({ data }, 'Info message');
logger.warn({ data }, 'Warning');
logger.error({ error }, 'Error occurred');
```

В development логи выводятся в pretty формате.
В production — JSON для парсинга.

### Инспекция БД во время разработки

```bash
# Подключиться к running collector БД
docker-compose exec postgres psql -U postgres -d gh_automation

# Посмотреть последние нотификации
SELECT * FROM github_notifications ORDER BY last_seen_at DESC LIMIT 10;

# Посмотреть pending события
SELECT * FROM outbox_events WHERE status = 'PENDING';

# Очистить тестовые данные
TRUNCATE github_notifications, outbox_events, collector_state CASCADE;
```

## Линтинг и форматирование

### ESLint

```bash
# Проверить
pnpm lint

# Автофикс
pnpm lint --fix
```

### Prettier

```bash
# Проверить
pnpm prettier --check .

# Форматировать
pnpm prettier --write .
```

### Pre-commit hook

`.husky/pre-commit`:

```bash
#!/bin/sh
pnpm lint
pnpm test --run
```

## Docker разработка

### Локальная сборка образов

```bash
# Собрать collector
docker build -f apps/github-notifications-collector/Dockerfile -t gh-collector .

# Собрать processor
docker build -f apps/event-processor-worker/Dockerfile -t gh-processor .

# Запустить
docker run --rm -e DATABASE_URL=... gh-collector
```

### docker-compose для разработки

```bash
# Запустить только PostgreSQL
docker-compose up -d postgres

# Запустить всё в фоне
docker-compose up -d

# Пересобрать и запустить
docker-compose up --build

# Просмотр логов
docker-compose logs -f collector

# Остановить и удалить всё
docker-compose down -v  # -v удаляет volumes
```

### Exec в контейнер

```bash
# Bash в collector
docker-compose exec collector sh

# Запустить gh notify вручную
docker-compose exec collector gh notify -an 10 -s
```

## Полезные команды

### Очистка

```bash
# Очистить build артефакты
pnpm clean

# Очистить node_modules
rm -rf node_modules packages/*/node_modules apps/*/node_modules

# Очистить Turbo cache
rm -rf .turbo

# Полная очистка
pnpm clean && rm -rf node_modules pnpm-lock.yaml && pnpm install
```

### Проверка зависимостей

```bash
# Устаревшие зависимости
pnpm outdated

# Обновить зависимости
pnpm update

# Audit безопасности
pnpm audit
```

### Build производительность

```bash
# Посмотреть статистику Turbo
pnpm build --summarize

# Очистить cache
turbo run build --force
```

## CI/CD

### GitHub Actions пример

`.github/workflows/ci.yml`:

```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: gh_automation
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - run: pnpm lint

      - run: pnpm build

      - run: pnpm test

      - name: Apply migrations
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/gh_automation
        run: pnpm --filter @gh-automation/database db:migrate
```

## Troubleshooting

### Ошибка: "Cannot find module"

```bash
# Пересобрать пакеты
pnpm build

# Или очистить и пересобрать
pnpm clean && pnpm install && pnpm build
```

### Ошибка: "Port 5432 already in use"

```bash
# Найти процесс
lsof -i :5432

# Остановить
docker-compose down

# Или убить процесс
kill -9 <PID>
```

### Ошибка миграции

```bash
# Откатить вручную
psql $DATABASE_URL

# В psql
DROP TABLE github_notifications CASCADE;
DROP TABLE outbox_events CASCADE;
DROP TABLE collector_state CASCADE;

# Применить заново
pnpm --filter @gh-automation/database db:migrate
```

### GH CLI ошибки

```bash
# Проверить авторизацию
gh auth status

# Переавторизоваться
gh auth login

# Проверить токен
echo $GH_TOKEN
```

## Best Practices

### 1. Типы и валидация

```typescript
// ✅ Good: используй типы из shared-types
import { NotificationReason } from '@gh-automation/shared-types';

// ❌ Bad: magic strings
const reason = 'mention';
```

### 2. Логирование

```typescript
// ✅ Good: structured logging
logger.info({ userId, action }, 'User action');

// ❌ Bad: string concatenation
logger.info('User ' + userId + ' performed ' + action);
```

### 3. Error handling

```typescript
// ✅ Good: catch и log
try {
  await doSomething();
} catch (error) {
  logger.error({ error }, 'Failed to do something');
  throw error;  // Re-throw если нужно
}

// ❌ Bad: silent failure
try {
  await doSomething();
} catch {}
```

### 4. Транзакции

```typescript
// ✅ Good: используй транзакции для связанных операций
await db.transaction(async (tx) => {
  await repo1.insert(data, tx);
  await repo2.insert(relatedData, tx);
});

// ❌ Bad: две отдельные операции
await repo1.insert(data);
await repo2.insert(relatedData);  // Может упасть после первой
```

### 5. Тесты

```typescript
// ✅ Good: описательные названия
it('should return 400 when email is invalid', () => {});

// ❌ Bad: неинформативные названия
it('test 1', () => {});
```

## Ресурсы

- [Turborepo Docs](https://turbo.build/repo/docs)
- [pnpm Docs](https://pnpm.io/)
- [Drizzle ORM Docs](https://orm.drizzle.team/)
- [Vitest Docs](https://vitest.dev/)
- [Pino Logger Docs](https://getpino.io/)
