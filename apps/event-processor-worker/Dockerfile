# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY .npmrc ./

# Install pnpm
RUN npm install -g pnpm@9

# Copy all workspace packages
COPY packages ./packages
COPY apps/event-processor-worker ./apps/event-processor-worker
COPY turbo.json ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build
RUN pnpm build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy package files
COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./

# Copy built artifacts
COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/database/src/migrations ./packages/database/src/migrations

COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist

COPY --from=builder /app/packages/logger/package.json ./packages/logger/
COPY --from=builder /app/packages/logger/dist ./packages/logger/dist

COPY --from=builder /app/packages/nats/package.json ./packages/nats/
COPY --from=builder /app/packages/nats/dist ./packages/nats/dist

COPY --from=builder /app/apps/event-processor-worker/package.json ./apps/event-processor-worker/
COPY --from=builder /app/apps/event-processor-worker/dist ./apps/event-processor-worker/dist

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app
USER app

WORKDIR /app/apps/event-processor-worker

CMD ["node", "dist/index.js"]
