# Database Schema

Полное описание схемы базы данных PostgreSQL.

## Обзор

База данных состоит из 3 основных таблиц:

1. **github_notifications** — хранение GitHub нотификаций
2. **outbox_events** — Transactional Outbox Pattern для событий
3. **collector_state** — состояние коллектора (singleton)

## Таблицы

### `github_notifications`

Хранит все собранные GitHub нотификации с дедупликацией.

```sql
CREATE TABLE github_notifications (
    id BIGSERIAL PRIMARY KEY,
    notification_id VARCHAR(255) NOT NULL UNIQUE,
    repository VARCHAR(255) NOT NULL,
    subject_type VARCHAR(50) NOT NULL,
    subject_number INTEGER,
    subject_title TEXT NOT NULL,
    subject_url TEXT,
    reason VARCHAR(50) NOT NULL,
    read BOOLEAN DEFAULT false NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_notifications_repo ON github_notifications(repository);
CREATE INDEX idx_notifications_updated_at ON github_notifications(updated_at);
CREATE INDEX idx_notifications_read ON github_notifications(read);
```

#### Поля

| Поле | Тип | Описание | Пример |
|------|-----|----------|--------|
| `id` | bigserial | Primary key, auto-increment | 1, 2, 3... |
| `notification_id` | varchar(255) | **Уникальный ID** (UNIQUE constraint). Формат: `{repo}:{type}:{number\|hash}` | `owner/repo:PullRequest:123` |
| `repository` | varchar(255) | GitHub репозиторий в формате `owner/repo` | `facebook/react` |
| `subject_type` | varchar(50) | Тип объекта: `PullRequest`, `Issue`, `Release`, `Commit`, `Discussion` | `PullRequest` |
| `subject_number` | integer | Номер PR/Issue (nullable для Release/Commit) | `123` или `NULL` |
| `subject_title` | text | Заголовок нотификации | `feat: add new feature` |
| `subject_url` | text | URL объекта (nullable) | `https://github.com/...` |
| `reason` | varchar(50) | Причина нотификации: `mention`, `author`, `review_requested`, etc. | `mention` |
| `read` | boolean | Прочитана ли нотификация | `false` |
| `updated_at` | timestamptz | Время последнего обновления нотификации в GitHub | `2024-02-06 12:34:56+00` |
| `first_seen_at` | timestamptz | Когда впервые увидели эту нотификацию | `2024-02-06 12:00:00+00` |
| `last_seen_at` | timestamptz | Когда последний раз видели (обновляется при UPSERT) | `2024-02-06 12:30:00+00` |
| `processed_at` | timestamptz | Когда обработали (nullable) | `2024-02-06 12:35:00+00` |

#### Индексы

- **idx_notifications_repo** — для фильтрации по репозиторию
- **idx_notifications_updated_at** — для сортировки по времени
- **idx_notifications_read** — для фильтрации непрочитанных

#### Constraint

- **UNIQUE(notification_id)** — предотвращает дубликаты

#### Queries

```sql
-- Все нотификации репозитория
SELECT * FROM github_notifications
WHERE repository = 'owner/repo'
ORDER BY updated_at DESC;

-- Непрочитанные нотификации
SELECT * FROM github_notifications
WHERE read = false
ORDER BY updated_at DESC;

-- Статистика по репозиториям
SELECT
  repository,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE read = false) as unread
FROM github_notifications
GROUP BY repository
ORDER BY total DESC;
```

---

### `outbox_events`

Transactional Outbox Pattern — события для публикации.

```sql
CREATE TABLE outbox_events (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID DEFAULT gen_random_uuid() NOT NULL UNIQUE,
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    metadata JSONB,
    status VARCHAR(20) DEFAULT 'PENDING' NOT NULL,
    retry_count INTEGER DEFAULT 0 NOT NULL,
    max_retries INTEGER DEFAULT 5 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    last_error_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_outbox_status_scheduled
ON outbox_events(status, scheduled_at);
```

#### Поля

| Поле | Тип | Описание | Пример |
|------|-----|----------|--------|
| `id` | bigserial | Primary key | 1, 2, 3... |
| `event_id` | uuid | UUID события (UNIQUE) | `550e8400-e29b-41d4-a716-446655440000` |
| `event_type` | varchar(100) | Тип события | `github.notification.created` |
| `aggregate_type` | varchar(100) | Тип агрегата | `GithubNotification` |
| `aggregate_id` | varchar(255) | ID агрегата (notification_id) | `owner/repo:PullRequest:123` |
| `payload` | jsonb | **Данные события** (полная нотификация) | `{"notificationId": "...", ...}` |
| `metadata` | jsonb | Метаданные (nullable) | `{"source": "gh-notify-collector"}` |
| `status` | varchar(20) | Статус: `PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED` | `PENDING` |
| `retry_count` | integer | Текущее количество попыток | `0`, `1`, `2`... |
| `max_retries` | integer | Максимум попыток | `5` |
| `created_at` | timestamptz | Время создания события | `2024-02-06 12:34:56+00` |
| `scheduled_at` | timestamptz | Когда обрабатывать (для retry с delay) | `2024-02-06 12:36:00+00` |
| `processed_at` | timestamptz | Когда обработали (nullable) | `2024-02-06 12:35:00+00` |
| `error_message` | text | Текст последней ошибки (nullable) | `Connection timeout` |
| `last_error_at` | timestamptz | Время последней ошибки (nullable) | `2024-02-06 12:35:30+00` |

#### Статусы

- **PENDING** — ожидает обработки
- **PROCESSING** — в процессе обработки
- **PUBLISHED** — успешно опубликовано
- **FAILED** — провалено после max_retries (Dead Letter)

#### Индексы

- **idx_outbox_status_scheduled** — для эффективного поиска событий к обработке:
  ```sql
  WHERE status IN ('PENDING', 'FAILED')
    AND scheduled_at <= NOW()
  ```

#### Constraint

- **UNIQUE(event_id)** — уникальность UUID

#### Queries

```sql
-- Pending события к обработке
SELECT * FROM outbox_events
WHERE status IN ('PENDING', 'FAILED')
  AND scheduled_at <= NOW()
ORDER BY created_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;  -- Критично для параллельных воркеров!

-- Статистика по статусам
SELECT status, COUNT(*) as count
FROM outbox_events
GROUP BY status;

-- Dead letter события
SELECT * FROM outbox_events
WHERE status = 'FAILED'
ORDER BY last_error_at DESC;

-- Retry события (scheduled для будущего)
SELECT * FROM outbox_events
WHERE status = 'PENDING'
  AND scheduled_at > NOW()
ORDER BY scheduled_at;
```

#### Payload структура

```json
{
  "notificationId": "owner/repo:PullRequest:123",
  "repository": "owner/repo",
  "subjectType": "PullRequest",
  "subjectNumber": 123,
  "subjectTitle": "feat: add new feature",
  "subjectUrl": "https://github.com/owner/repo/pull/123",
  "reason": "mention",
  "read": false,
  "updatedAt": "2024-02-06T12:34:56.000Z",
  "firstSeenAt": "2024-02-06T12:00:00.000Z",
  "lastSeenAt": "2024-02-06T12:30:00.000Z"
}
```

---

### `collector_state`

Состояние коллектора (singleton — всегда одна строка).

```sql
CREATE TABLE collector_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    last_successful_run TIMESTAMP WITH TIME ZONE,
    last_notification_updated_at TIMESTAMP WITH TIME ZONE,
    total_collected BIGINT DEFAULT 0,
    total_published BIGINT DEFAULT 0,
    CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO collector_state (id) VALUES (1);
```

#### Поля

| Поле | Тип | Описание | Пример |
|------|-----|----------|--------|
| `id` | integer | Primary key, всегда = 1 | `1` |
| `last_successful_run` | timestamptz | Время последнего успешного запуска | `2024-02-06 12:35:00+00` |
| `last_notification_updated_at` | timestamptz | `updated_at` последней собранной нотификации | `2024-02-06 12:34:00+00` |
| `total_collected` | bigint | Всего собрано нотификаций (lifetime) | `1523` |
| `total_published` | bigint | Всего опубликовано событий (lifetime) | `1520` |

#### Constraint

- **CHECK(id = 1)** — гарантирует singleton (только одна строка)

#### Queries

```sql
-- Получить состояние
SELECT * FROM collector_state WHERE id = 1;

-- Обновить после успешного сбора
UPDATE collector_state
SET
  last_successful_run = NOW(),
  total_collected = total_collected + :new_count,
  total_published = total_published + :new_count
WHERE id = 1;
```

## Транзакции

### Ключевой паттерн: Transactional Outbox

При сохранении нотификации обязательно создаём событие в **одной транзакции**:

```sql
BEGIN;

  -- 1. Сохранить/обновить нотификацию
  INSERT INTO github_notifications (
    notification_id,
    repository,
    subject_type,
    subject_number,
    subject_title,
    reason,
    read,
    updated_at
  ) VALUES (
    'owner/repo:PullRequest:123',
    'owner/repo',
    'PullRequest',
    123,
    'feat: add feature',
    'mention',
    false,
    NOW()
  )
  ON CONFLICT (notification_id) DO UPDATE SET
    subject_title = EXCLUDED.subject_title,
    read = EXCLUDED.read,
    updated_at = EXCLUDED.updated_at,
    last_seen_at = NOW()
  RETURNING *;

  -- 2. Создать событие в outbox
  INSERT INTO outbox_events (
    event_type,
    aggregate_type,
    aggregate_id,
    payload,
    metadata
  ) VALUES (
    'github.notification.created',
    'GithubNotification',
    'owner/repo:PullRequest:123',
    '{"notificationId": "...", ...}'::jsonb,
    '{"source": "gh-notify-collector"}'::jsonb
  );

COMMIT;  -- Либо оба успешны, либо rollback
```

**Гарантия:** Событие в outbox существует ⟺ данные в БД.

## Миграции

Миграции генерируются через Drizzle Kit.

### Создание новой миграции

```bash
# 1. Изменить schema в src/schema/*.ts
# 2. Сгенерировать миграцию
pnpm --filter @gh-automation/database db:generate

# 3. Проверить SQL
cat packages/database/src/migrations/000X_*.sql

# 4. Применить
pnpm --filter @gh-automation/database db:migrate
```

### История миграций

- **0000_initial_schema.sql** — создание всех таблиц и индексов

## Performance

### Рекомендации

1. **Connection pooling:**
   ```typescript
   const client = postgres(connectionString, {
     max: 10,           // Максимум соединений
     idle_timeout: 20,  // Таймаут idle соединений
   });
   ```

2. **Индексы:**
   - Все часто используемые фильтры покрыты индексами
   - JSONB поля (`payload`, `metadata`) — индексы не нужны для MVP

3. **VACUUM:**
   ```sql
   -- Периодически
   VACUUM ANALYZE github_notifications;
   VACUUM ANALYZE outbox_events;
   ```

4. **Monitoring:**
   ```sql
   -- Размер таблиц
   SELECT
     schemaname,
     tablename,
     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
   FROM pg_tables
   WHERE schemaname = 'public'
   ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

   -- Статистика индексов
   SELECT * FROM pg_stat_user_indexes;
   ```

## Backup & Restore

### Backup

```bash
# Полный бэкап
pg_dump gh_automation > backup_$(date +%Y%m%d).sql

# С компрессией
pg_dump gh_automation | gzip > backup_$(date +%Y%m%d).sql.gz

# Только схема
pg_dump --schema-only gh_automation > schema.sql

# Только данные
pg_dump --data-only gh_automation > data.sql
```

### Restore

```bash
# Из файла
psql gh_automation < backup.sql

# Из gzip
gunzip -c backup.sql.gz | psql gh_automation

# Или
zcat backup.sql.gz | psql gh_automation
```

## Cleanup

### Удаление старых событий

```sql
-- Удалить опубликованные события старше 30 дней
DELETE FROM outbox_events
WHERE status = 'PUBLISHED'
  AND processed_at < NOW() - INTERVAL '30 days';

-- Архивировать старые нотификации
CREATE TABLE github_notifications_archive AS
SELECT * FROM github_notifications
WHERE updated_at < NOW() - INTERVAL '90 days';

DELETE FROM github_notifications
WHERE updated_at < NOW() - INTERVAL '90 days';
```

### Партиционирование (future)

Для больших объёмов данных можно использовать партиционирование:

```sql
-- Партиционирование outbox_events по created_at
CREATE TABLE outbox_events (
  -- поля...
) PARTITION BY RANGE (created_at);

CREATE TABLE outbox_events_2024_02
PARTITION OF outbox_events
FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

-- И т.д. для каждого месяца
```

## Security

### Row-Level Security (future)

Для multi-tenancy:

```sql
ALTER TABLE github_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON github_notifications
  USING (repository LIKE current_setting('app.tenant_prefix') || '%');
```

### Аудит

```sql
-- Добавить поля аудита
ALTER TABLE github_notifications
  ADD COLUMN created_by VARCHAR(255),
  ADD COLUMN updated_by VARCHAR(255);
```

## Troubleshooting

### Найти долгие запросы

```sql
SELECT
  pid,
  now() - query_start as duration,
  query,
  state
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;
```

### Найти блокировки

```sql
SELECT * FROM pg_locks
WHERE NOT granted;
```

### Убить долгий запрос

```sql
SELECT pg_cancel_backend(pid);  -- Graceful
SELECT pg_terminate_backend(pid);  -- Force
```

## Extensions (future)

Полезные расширения для будущего:

```sql
-- Full-text search
CREATE EXTENSION pg_trgm;
CREATE INDEX idx_notifications_title_trgm
ON github_notifications
USING gin (subject_title gin_trgm_ops);

-- UUID v7 (time-ordered)
CREATE EXTENSION pg_uuidv7;
```
