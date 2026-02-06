# Build stage
FROM node:20-alpine AS builder

# Install GitHub CLI
RUN apk add --no-cache github-cli

WORKDIR /app

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY .npmrc ./

# Install pnpm
RUN npm install -g pnpm@9

# Copy all workspace packages
COPY packages ./packages
COPY apps/github-notifications-collector ./apps/github-notifications-collector
COPY turbo.json ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build
RUN pnpm build

# Runtime stage
FROM node:20-alpine

# Install GitHub CLI
RUN apk add --no-cache github-cli

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

COPY --from=builder /app/apps/github-notifications-collector/package.json ./apps/github-notifications-collector/
COPY --from=builder /app/apps/github-notifications-collector/dist ./apps/github-notifications-collector/dist

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

WORKDIR /app/apps/github-notifications-collector

CMD ["node", "dist/index.js"]
