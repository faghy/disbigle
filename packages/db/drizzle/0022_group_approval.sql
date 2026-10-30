ALTER TYPE "public"."notification_type" ADD VALUE 'group_post_pending';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'group_post_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'group_post_rejected';--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "join_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "post_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "pending_approval" boolean DEFAULT false NOT NULL;