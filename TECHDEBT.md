# Technical Debt

Список отложенных улучшений и технического долга в проекте.

## claude-job-runner

### Testing Coverage

**Priority:** Low
**Source:** CodeRabbit PR #8 Review ([Thread #73c995](https://github.com/fixcik/gh-automation/pull/8#discussion_r2776208694))

Отсутствуют unit-тесты для метода `ClaudeConfigBuilder.buildMcpConfig`.

Согласно коду в `claude-config-builder.ts` (строки 38-76), `buildMcpConfig` содержит логику:
- Создание job-comm сервера с env переменными
- Объединение extraServers
- Запись JSON файла

**Рекомендуется добавить тесты для:**
- Генерации корректной структуры MCP конфига
- Объединения extraServers
- Создания файла в указанной директории

**Статус:** Отложено для MVP

---

### Publisher Reliability

**Priority:** Medium
**Source:** CodeRabbit PR #8 Review ([Thread #2280f4](https://github.com/fixcik/gh-automation/pull/8#discussion_r2776208751))

Ошибки публикации результата в `JobExecutor.publishResult()` только логируются (fire-and-forget подход).

**Текущее поведение:**

```typescript
await this.publishResult(request, errorResult);
// Если publisher.publish завершается с ошибкой, результат не будет доставлен
```

Если `publisher.publish` завершается с ошибкой, результат джоба не будет доставлен потребителям. Текущая реализация "fire-and-forget" приемлема для MVP, но для production стоит рассмотреть:

**Варианты улучшения:**
- Retry-логику с экспоненциальным backoff
- Интеграцию с transactional outbox (сохранение результата в БД + отдельный worker для отправки)
- Dead letter queue для неотправленных результатов

**Статус:** Приемлемо для MVP, требует улучшения для production

---

## Обновления

- **2026-02-07:** Создан файл, добавлены 2 пункта из CodeRabbit review PR #8
