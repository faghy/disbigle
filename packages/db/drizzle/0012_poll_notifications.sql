ALTER TYPE "public"."notification_type" ADD VALUE 'poll';--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "end_notified_at" timestamp with time zone;