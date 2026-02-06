# GitHub Automation - Turborepo Monorepo

Монорепозиторий для автоматизации работы с GitHub. Первый сервис собирает нотификации из GitHub через команду `gh notify` и публикует их как события с гарантией доставки.

## ✨ Особенности

- 🏗️ **Turborepo монорепо** — параллельная сборка, кэширование задач
- 📦 **pnpm workspaces** — эффективное управление зависимостями
- 🗄️ **PostgreSQL + Drizzle ORM** — типобезопасная работа с БД
- 📮 **Transactional Outbox Pattern** — гарантия доставки событий
- 🔄 **Automatic retry** — exponential backoff для failed событий
- 🐳 **Docker** — готовая контейнеризация всех сервисов
- 📊 **Structured logging** — Pino для production-ready логирования

## 📋 Требования

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0
- **PostgreSQL** >= 16
- **GitHub CLI** (`gh`) — установлен и авторизован
- **Docker** и **Docker Compose** (опционально)

## 🚀 Быстрый старт

### 1. Установка зависимостей

```bash
pnpm install
```

### 2. Настройка окружения

```bash
cp .env.example .env
```

Отредактируйте `.env`:

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gh_automation

# GitHub
GH_TOKEN=ghp_xxxxxxxxxxxxx  # Ваш GitHub токен

# Collector
COLLECTOR_SCHEDULE=*/5 * * * *  # Каждые 5 минут
GH_NOTIFY_LIMIT=100

# Outbox Processor
PROCESSOR_INTERVAL_MS=1000
BATCH_SIZE=100
MAX_RETRIES=5

# Logging
LOG_LEVEL=info
```

### 3. Запуск через Docker Compose (рекомендуется)

```bash
# Собрать и запустить все сервисы
docker-compose up --build

# В фоновом режиме
docker-compose up -d

# Просмотр логов
docker-compose logs -f collector
docker-compose logs -f processor

# Остановка
docker-compose down
```

### 4. Локальная разработка

Запустите PostgreSQL:

```bash
docker-compose up -d postgres
```

Примените миграции:

```bash
pnpm --filter @gh-automation/database db:migrate
```

Запустите сервисы в dev режиме:

```bash
# Terminal 1 - Collector
pnpm --filter @gh-automation/github-notifications-collector dev

# Terminal 2 - Processor
pnpm --filter @gh-automation/event-processor-worker dev
```

## 📁 Структура проекта

```
gh-automation/
├── apps/
│   ├── github-notifications-collector/  # Сервис сбора нотификаций
│   └── event-processor-worker/          # Воркер обработки outbox
├── packages/
│   ├── database/                        # PostgreSQL + Drizzle ORM
│   ├── shared-types/                    # TypeScript типы
│   ├── logger/                          # Pino logger
│   └── config/                          # Shared configs
├── docker-compose.yml
├── turbo.json
└── README.md
```

## 🔄 Как это работает

### Transactional Outbox Pattern

**Гарантия:** событие опубликовано ⟺ данные сохранены

```sql
BEGIN;
  INSERT INTO github_notifications (...);
  INSERT INTO outbox_events (...);
COMMIT;  -- Либо оба успешны, либо откат
```

## 🧪 Тестирование

```bash
# Все тесты
pnpm test

# Тесты конкретного пакета
pnpm --filter @gh-automation/github-notifications-collector test
```

## 🔨 Разработка

```bash
# Сборка
pnpm build

# Линтинг
pnpm lint

# Генерация миграций
pnpm --filter @gh-automation/database db:generate

# Drizzle Studio
pnpm --filter @gh-automation/database db:studio
```

## 📚 Документация

Подробная документация в директории [docs/](docs/)
