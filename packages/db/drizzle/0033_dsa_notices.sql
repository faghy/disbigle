ALTER TABLE "reports" ALTER COLUMN "reporter_actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "source" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "notifier_name" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "notifier_email" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "notifier_locale" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "content_url" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "decision" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "decision_reason" text DEFAULT '' NOT NULL;