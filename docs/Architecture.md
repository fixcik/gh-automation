# Архитектура

## Общая схема

```
┌──────────────────────────────────────────────────────────────────┐
│                    GitHub Notifications Collector                 │
│                                                                   │
│  ┌──────────────┐    ┌─────────────┐    ┌──────────────────┐    │
│  │ CronScheduler│───▶│GhNotifyParser│───▶│NotificationProc  │    │
│  └──────────────┘    └─────────────┘    │  + OutboxPublisher│    │
│                                          └────────┬─────────┘    │
└──────────────────────────────────────────────────┼──────────────┘
                                                    │
                                                    ▼
                                          ┌─────────────────┐
                                          │   PostgreSQL    │
                                          │                 │
                                          │ github_notif... │
                                          │ outbox_events   │
                                          │ collector_state │
                                          └────────┬────────┘
                                                   │
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Event Processor Worker                         │
│                                                                   │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐   │
│  │ Polling Loop │───▶│OutboxProcessor   │───▶│ Event        │   │
│  │ (1s interval)│    │ (FOR UPDATE      │    │ Publisher    │   │
│  │              │    │  SKIP LOCKED)    │    │ (MVP: log)   │   │
│  └──────────────┘    └──────────────────┘    └──────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Компоненты

### 1. GitHub Notifications Collector

**Назначение:** Периодический сбор нотификаций из GitHub через `gh notify`.

**Подкомпоненты:**

- **CronScheduler** — запускает сбор по расписанию (default: каждые 5 минут)
- **GhNotifyParser** — парсит табличный вывод `gh notify -an <limit> -s`
- **NotificationProcessor** — генерирует детерминированные ID, валидирует enums
- **OutboxPublisher** — транзакционная публикация событий в outbox

**Flow:**
1. Cron триггерит сбор
2. Запуск `gh notify` через execa
3. Парсинг вывода в структурированные данные
4. Обработка и дедупликация
5. **Транзакция:** INSERT/UPSERT notification + INSERT outbox event
6. Обновление collector_state

### 2. Event Processor Worker

**Назначение:** Асинхронная обработка событий из outbox.

**Подкомпоненты:**

- **OutboxProcessor** — polling outbox таблицы
- **Event Publisher** — публикация событий (MVP: логирование, production: webhooks/Redis)
- **Retry Handler** — exponential backoff для failed событий

**Flow:**
1. Polling loop (каждую секунду)
2. `SELECT ... FOR UPDATE SKIP LOCKED` — читаем batch событий
3. Для каждого:
   - Помечаем как PROCESSING
   - Публикуем (MVP: логируем)
   - Помечаем как PUBLISHED
4. При ошибке: retry с exponential backoff
5. После max_retries → FAILED (Dead Letter)

## Ключевые паттерны

### Transactional Outbox Pattern

**Проблема:** Как гарантировать, что событие будет опубликовано, если данные сохранены?

**Решение:** В одной транзакции сохраняем данные + создаём событие в outbox таблице.

```typescript
await db.transaction(async (tx) => {
  // 1. Сохранить данные
  const notification = await notificationRepo.upsert(data, tx);

  // 2. Создать событие
  await outboxPublisher.publish(notification, tx);

  // Если хоть один упадёт — откат всей транзакции
});
```

**Гарантия:** Событие в outbox ⟺ данные в БД.

Отдельный воркер асинхронно читает outbox и публикует события.

### Deduplication через UPSERT

GitHub API может вернуть одну и ту же нотификацию несколько раз. Используем `ON CONFLICT DO UPDATE`:

```sql
INSERT INTO github_notifications (notification_id, ...)
VALUES (...)
ON CONFLICT (notification_id) DO UPDATE SET
  subject_title = EXCLUDED.subject_title,
  last_seen_at = NOW(),
  ...
RETURNING *;
```

Детерминированный `notification_id`:
- С номером: `owner/repo:PullRequest:123`
- Без номера: `owner/repo:Release:abc123` (hash от title)

### Exponential Backoff

При ошибке публикации события откладываем retry:

```typescript
const retryDelayMinutes = Math.pow(2, retryCount + 1);
// retry_count=0 → 2 минуты
// retry_count=1 → 4 минуты
// retry_count=2 → 8 минут
// retry_count=3 → 16 минут
// retry_count=4 → 32 минуты
```

После `max_retries` (default: 5) → status = FAILED (Dead Letter).

### FOR UPDATE SKIP LOCKED

Позволяет запускать несколько воркеров параллельно без конфликтов:

```sql
SELECT * FROM outbox_events
WHERE status IN ('PENDING', 'FAILED')
  AND scheduled_at <= NOW()
ORDER BY created_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

- `FOR UPDATE` — блокирует строки для обновления
- `SKIP LOCKED` — пропускает уже заблокированные строки

Результат: воркеры не конкурируют за одни и те же события.

## Масштабирование

### Horizontal Scaling

**Collector:**
- Можно запустить несколько инстансов
- Но: `gh notify` вернёт одинаковые нотификации
- Дедупликация через UPSERT решает проблему
- Trade-off: больше load на GitHub API

**Processor:**
- `FOR UPDATE SKIP LOCKED` позволяет N воркеров
- Каждый воркер получает свой batch событий
- Линейно масштабируется с нагрузкой

### Vertical Scaling

**Database:**
- Connection pooling (default: 10 connections)
- Увеличить `max_connections` в PostgreSQL
- Добавить Read Replicas для аналитики

**Memory:**
- Node.js heap можно увеличить через `--max-old-space-size`
- Batch size можно уменьшить для меньшего memory footprint

## Мониторинг

### Метрики для отслеживания

**Collector:**
- Время выполнения `gh notify`
- Количество собранных нотификаций
- Количество новых vs обновлённых
- Ошибки парсинга

**Processor:**
- Outbox lag (количество pending событий)
- Throughput (событий/сек)
- Retry rate
- Dead letter count

**Database:**
- Connection pool utilization
- Query latency
- Lock wait time

### Health Checks

Добавить `/health` endpoints:

```typescript
app.get('/health', async (req, res) => {
  const dbHealthy = await checkDatabase();
  const outboxLag = await getOutboxLag();

  if (!dbHealthy || outboxLag > 10000) {
    return res.status(503).json({ status: 'unhealthy' });
  }

  res.json({ status: 'healthy', outboxLag });
});
```

## Миграция на Redis Streams (будущее)

Текущий подход (PostgreSQL polling) работает до ~1000 событий/сек.

Для higher throughput:

1. **Вместо polling** — LISTEN/NOTIFY в PostgreSQL
2. **Redis Streams** — замена outbox таблицы
3. **Kafka** — для enterprise scale

Redis Streams пример:

```typescript
// Publisher
await redis.xadd('events', '*', 'event', JSON.stringify(event));

// Consumer
const stream = redis.xread('BLOCK', 1000, 'STREAMS', 'events', lastId);
```

Преимущества:
- Latency ~1-10ms (vs 100-500ms polling)
- Throughput ~100k событий/сек
- Встроенные consumer groups

Недостатки:
- Ещё одна зависимость (Redis)
- Сложнее отладка
- Нужен механизм persistence (AOF/RDB)

## Security

### Токены

- `GH_TOKEN` — GitHub Personal Access Token
- Хранить в `.env` (не коммитить!)
- В production: секреты через Vault/AWS Secrets Manager

### Database

- Пароль PostgreSQL — через переменные окружения
- SSL/TLS для production подключений
- Row-level security (RLS) для multi-tenancy

### Docker

- Multi-stage builds — не включаем dev зависимости
- Run as non-root user
- Security scanning — `docker scan`

## Disaster Recovery

### Backup

PostgreSQL:
```bash
pg_dump gh_automation > backup.sql
```

Автоматизация:
```yaml
# Cron job
0 2 * * * pg_dump gh_automation | gzip > /backups/db_$(date +\%Y\%m\%d).sql.gz
```

### Restore

```bash
psql gh_automation < backup.sql
```

### Failed Events Recovery

Dead letter события можно переобработать вручную:

```sql
-- Найти failed события
SELECT * FROM outbox_events WHERE status = 'FAILED';

-- Вернуть в очередь
UPDATE outbox_events
SET status = 'PENDING',
    retry_count = 0,
    scheduled_at = NOW()
WHERE id = <event_id>;
```

## Trade-offs

### Почему Outbox вместо Message Broker?

**Pros:**
- ✅ Минимальная инфраструктура (только PostgreSQL)
- ✅ ACID гарантии из коробки
- ✅ Простота отладки (всё в SQL)
- ✅ Быстрый MVP (часы, а не дни)

**Cons:**
- ❌ Latency ~100-500ms (vs ~1-10ms Redis)
- ❌ Throughput ~1000 событий/сек (vs ~100k Redis)
- ❌ Дополнительная нагрузка на БД

**Вердикт:** Для GitHub notifications (десятки событий/минуту) — overkill использовать Redis/Kafka.

### Почему Drizzle вместо Prisma?

**Pros:**
- ✅ Нативная поддержка `FOR UPDATE SKIP LOCKED`
- ✅ Полный контроль над SQL
- ✅ Легковесный (~50KB vs ~2MB)
- ✅ Мгновенный старт (нет engine binary)

**Cons:**
- ❌ Менее зрелая экосистема
- ❌ Меньше готовых интеграций

**Вердикт:** Для data-pipeline проекта с complex SQL — Drizzle лучше.

## Дальнейшая эволюция

1. **GitHub Webhooks** — вместо polling через `gh notify`
2. **GraphQL API** — для обогащения данных
3. **Multi-collector** — GitLab, Jira, Linear
4. **Event Schema Registry** — версионирование событий
5. **CQRS** — read models для аналитики
6. **Saga Pattern** — distributed transactions
