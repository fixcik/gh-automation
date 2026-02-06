CREATE TYPE "public"."event_status" AS ENUM('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');--> statement-breakpoint
ALTER TABLE "outbox_events" ALTER COLUMN "status" SET DATA TYPE event_status;