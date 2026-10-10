CREATE TYPE "public"."domain_block_severity" AS ENUM('silence', 'suspend');--> statement-breakpoint
CREATE TYPE "public"."report_category" AS ENUM('spam', 'illegal', 'harassment', 'violation', 'other');--> statement-breakpoint
CREATE TABLE "admin_action_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"severity" "domain_block_severity" NOT NULL,
	"public_comment" text DEFAULT '' NOT NULL,
	"private_comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_actor_id" uuid NOT NULL,
	"target_actor_id" uuid NOT NULL,
	"post_ids" uuid[] DEFAULT '{}' NOT NULL,
	"category" "report_category" DEFAULT 'other' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"forwarded" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_action_logs" ADD CONSTRAINT "admin_action_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_actor_id_actors_id_fk" FOREIGN KEY ("reporter_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_actor_id_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_action_logs_created_idx" ON "admin_action_logs" USING btree ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_blocks_domain_idx" ON "domain_blocks" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_actor_id");--> statement-breakpoint
CREATE INDEX "reports_open_idx" ON "reports" USING btree ("id") WHERE "reports"."resolved_at" is null;