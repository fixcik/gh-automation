CREATE TABLE IF NOT EXISTS "github_notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"notification_id" varchar(255) NOT NULL,
	"repository" varchar(255) NOT NULL,
	"subject_type" varchar(50) NOT NULL,
	"subject_number" integer,
	"subject_title" text NOT NULL,
	"subject_url" text,
	"reason" varchar(50) NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "github_notifications_notification_id_unique" UNIQUE("notification_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbox_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"aggregate_type" varchar(100) NOT NULL,
	"aggregate_id" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error_message" text,
	"last_error_at" timestamp with time zone,
	CONSTRAINT "outbox_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collector_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_successful_run" timestamp with time zone,
	"last_notification_updated_at" timestamp with time zone,
	"total_collected" bigint DEFAULT 0,
	"total_published" bigint DEFAULT 0,
	CONSTRAINT "single_row" CHECK ("collector_state"."id" = 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_repo" ON "github_notifications" USING btree ("repository");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_updated_at" ON "github_notifications" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_read" ON "github_notifications" USING btree ("read");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_outbox_status_scheduled" ON "outbox_events" USING btree ("status","scheduled_at");