# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a Turborepo monorepo for GitHub automation. The primary service collects GitHub notifications via `gh notify` and publishes them as events using the Transactional Outbox Pattern for guaranteed delivery.

## Architecture

### Core Pattern: Transactional Outbox

The system implements Transactional Outbox Pattern to guarantee event delivery:

```typescript
await db.transaction(async (tx) => {
  // 1. Save data (upsert notification)
  const notification = await notificationRepo.upsert(data, tx);

  // 2. Create event in outbox (same transaction)
  await outboxPublisher.publish(notification, tx);

  // If either fails, entire transaction rolls back
});
```

**Key guarantee:** Event exists in outbox ⟺ Data exists in database.

A separate worker asynchronously processes the outbox table using `SELECT ... FOR UPDATE SKIP LOCKED` for horizontal scaling.

### Two-Service Architecture

1. **github-notifications-collector** (`apps/github-notifications-collector/`)
   - Runs on cron schedule (default: every 5 minutes)
   - Executes `gh notify` via `execa`
   - Parses tabular output (GhNotifyParser)
   - Generates deterministic IDs for deduplication
   - Saves to DB + publishes to outbox (single transaction)

2. **event-processor-worker** (`apps/event-processor-worker/`)
   - Polls `outbox_events` table every second
   - Uses `FOR UPDATE SKIP LOCKED` (allows multiple workers)
   - Implements exponential backoff retry (2^n minutes)
   - Dead letter handling after max_retries

### Database Schema (PostgreSQL + Drizzle ORM)

Three tables:
- `github_notifications`: Stores notifications with deduplication
- `outbox_events`: Transactional outbox for event publishing
- `collector_state`: Singleton for collector metadata

**Critical:** Always pass transaction object (`tx`) to repository methods when working within a transaction.

## Development Commands

### Setup

```bash
# Install dependencies
pnpm install

# Setup environment
cp .env.example .env
# Add GH_TOKEN to .env

# Start PostgreSQL
docker-compose up -d postgres

# Run migrations
pnpm --filter @gh-automation/database db:migrate
```

### Build & Test

```bash
# Build all packages (uses Turborepo cache)
pnpm build

# Run tests (currently: 16 unit tests in collector)
pnpm --filter @gh-automation/github-notifications-collector test run

# Run specific test file
cd apps/github-notifications-collector
pnpm test gh-notify-parser.test.ts
```

### Development

```bash
# Run collector in dev mode (with watch)
pnpm --filter @gh-automation/github-notifications-collector dev

# Run processor in dev mode
pnpm --filter @gh-automation/event-processor-worker dev

# Run all services via Docker
docker-compose up --build
```

### Database Operations

```bash
# Generate migration after schema changes
pnpm --filter @gh-automation/database db:generate

# Apply migrations
pnpm --filter @gh-automation/database db:migrate

# Open Drizzle Studio (GUI)
pnpm --filter @gh-automation/database db:studio

# Connect to PostgreSQL directly
docker-compose exec postgres psql -U postgres -d gh_automation
```

## Working with Packages

### Package Filter Syntax

```bash
# Specific package
pnpm --filter @gh-automation/database <command>

# All packages in directory
pnpm --filter "./packages/*" build

# App
pnpm --filter @gh-automation/github-notifications-collector dev
```

### Adding Dependencies

```bash
# Add to specific package
pnpm --filter @gh-automation/database add drizzle-orm

# Add workspace dependency
pnpm --filter @gh-automation/github-notifications-collector add @gh-automation/database@workspace:*

# Add dev dependency
pnpm --filter @gh-automation/database add -D vitest
```

## Critical Implementation Details

### Import Paths (ESM)

All imports MUST use `.js` extension (TypeScript with Node16 module resolution):

```typescript
// ✅ Correct
import { Parser } from './parser.js';

// ❌ Wrong
import { Parser } from './parser';
```

### Repository Pattern

All database operations go through repositories in `packages/database/src/repositories/`:

```typescript
// Always pass transaction when inside db.transaction()
await db.transaction(async (tx) => {
  await notificationRepo.upsert(data, tx);  // ✅ Pass tx
  await outboxRepo.insert(event, tx);       // ✅ Pass tx
});
```

### Notification ID Generation

Deterministic IDs prevent duplicates:
- With number: `owner/repo:PullRequest:123`
- Without number: `owner/repo:Release:abc123` (hash of title)

Implemented in `NotificationProcessor.generateNotificationId()`.

### FOR UPDATE SKIP LOCKED

When writing SQL that reads from `outbox_events` for processing, always use:

```sql
SELECT * FROM outbox_events
WHERE status IN ('PENDING', 'FAILED')
  AND scheduled_at <= NOW()
ORDER BY created_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED  -- Critical for multiple workers
```

This is already implemented in `OutboxRepository.fetchPending()`.

## Testing Strategy

- **Unit tests:** For parsers and processors (GhNotifyParser, NotificationProcessor)
- **Integration tests:** Would test with actual database (not implemented yet)
- Test framework: Vitest
- Run tests before committing changes to collector logic

## Environment Variables

Required for local development:
- `DATABASE_URL`: PostgreSQL connection string
- `GH_TOKEN`: GitHub personal access token
- `COLLECTOR_SCHEDULE`: Cron expression (default: `*/5 * * * *`)
- `LOG_LEVEL`: Logging level (default: `info`)

See `.env.example` for complete list.

## Git Worktrees

**Use `/using-git-worktrees` skill for guided setup.**

New features/fixes require isolated worktree in `.worktrees/`:
- **Create:** `git worktree add .worktrees/<branch-name> -b <branch-name>`
- **Initialize:** `cd .worktrees/<branch-name> && pnpm install && pnpm build`
- **Infrastructure:** Run `docker-compose up -d` from main directory (shared across worktrees)
- **Development:** Execute all scripts (dev, test, build) from worktree directory

## Common Gotchas

1. **Turborepo cache:** If build seems stale, run `pnpm build --force` to bypass cache
2. **Migration order:** Always run `db:generate` before `db:migrate` when schema changes
3. **Transaction scope:** Repository methods accept optional `tx` parameter - use it inside transactions
4. **GitHub CLI:** Collector requires `gh` CLI authenticated (`gh auth status`)
5. **pnpm workspaces:** Package names must match `@gh-automation/*` pattern

## Implementation Plans

Plans are stored in `.claude/plans/` in Markdown format with naming convention `YYYY-MM-DD-<feature-name>.md`.

## Documentation

Comprehensive docs in `/docs`:
- `Architecture.md`: Patterns, scaling, trade-offs
- `Database-Schema.md`: Full schema, queries, indexes
- `Development.md`: Detailed workflow, troubleshooting

When adding new features, update relevant documentation.
