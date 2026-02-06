CREATE TYPE "public"."event_status" AS ENUM('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');--> statement-breakpoint
ALTER TABLE "outbox_events"
  ALTER COLUMN "status" TYPE "public"."event_status"
  USING "status"::"public"."event_status";