CREATE TYPE "public"."group_member_state" AS ENUM('member', 'requested', 'invited');--> statement-breakpoint
CREATE TYPE "public"."group_privacy" AS ENUM('public', 'private', 'secret');--> statement-breakpoint
CREATE TYPE "public"."group_role" AS ENUM('admin', 'moderator', 'member');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'group_request';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'group_invite';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'group_accepted';--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"role" "group_role" DEFAULT 'member' NOT NULL,
	"state" "group_member_state" DEFAULT 'member' NOT NULL,
	"invited_by_id" uuid,
	"ap_uri" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_actor_id_pk" PRIMARY KEY("group_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"privacy" "group_privacy" DEFAULT 'public' NOT NULL,
	"private_key_pem" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "is_group" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_invited_by_id_actors_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_id_actors_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_members_actor_idx" ON "group_members" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_actor_idx" ON "groups" USING btree ("actor_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_group_idx" ON "posts" USING btree ("group_id","id") WHERE "posts"."group_id" is not null;