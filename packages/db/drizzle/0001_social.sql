CREATE TYPE "public"."media_type" AS ENUM('image', 'video', 'audio', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('follow', 'follow_request', 'mention', 'reply', 'reblog', 'like');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'unlisted', 'followers', 'limited', 'direct');--> statement-breakpoint
CREATE TABLE "aspect_memberships" (
	"aspect_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aspect_memberships_aspect_id_actor_id_pk" PRIMARY KEY("aspect_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "aspects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_actor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"actor_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_actor_id_post_id_pk" PRIMARY KEY("actor_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "follow_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_actor_id" uuid NOT NULL,
	"ap_uri" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_actor_id" uuid NOT NULL,
	"ap_uri" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"ap_uri" text,
	"diaspora_guid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"post_id" uuid,
	"type" "media_type" NOT NULL,
	"mime_type" text NOT NULL,
	"file_path" text,
	"preview_path" text,
	"remote_url" text,
	"width" integer,
	"height" integer,
	"blurhash" text,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"post_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	CONSTRAINT "mentions_post_id_actor_id_pk" PRIMARY KEY("post_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "mutes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"from_actor_id" uuid NOT NULL,
	"post_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_aspects" (
	"post_id" uuid NOT NULL,
	"aspect_id" uuid NOT NULL,
	CONSTRAINT "post_aspects_post_id_aspect_id_pk" PRIMARY KEY("post_id","aspect_id")
);
--> statement-breakpoint
CREATE TABLE "post_audiences" (
	"post_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	CONSTRAINT "post_audiences_post_id_actor_id_pk" PRIMARY KEY("post_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "post_tags" (
	"post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "post_tags_post_id_tag_id_pk" PRIMARY KEY("post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"local" boolean NOT NULL,
	"visibility" "visibility" NOT NULL,
	"source" text,
	"content_html" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"language" text,
	"in_reply_to_id" uuid,
	"in_reply_to_actor_id" uuid,
	"thread_root_id" uuid,
	"reblog_of_id" uuid,
	"ap_uri" text,
	"ap_url" text,
	"diaspora_guid" text,
	"replies_count" integer DEFAULT 0 NOT NULL,
	"reblogs_count" integer DEFAULT 0 NOT NULL,
	"likes_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tag_follows" (
	"actor_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_follows_actor_id_tag_id_pk" PRIMARY KEY("actor_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tombstones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"uri" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aspect_memberships" ADD CONSTRAINT "aspect_memberships_aspect_id_aspects_id_fk" FOREIGN KEY ("aspect_id") REFERENCES "public"."aspects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aspect_memberships" ADD CONSTRAINT "aspect_memberships_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aspects" ADD CONSTRAINT "aspects_owner_actor_id_actors_id_fk" FOREIGN KEY ("owner_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_target_actor_id_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_requests" ADD CONSTRAINT "follow_requests_target_actor_id_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_target_actor_id_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_attachments_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_attachments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_target_actor_id_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_from_actor_id_actors_id_fk" FOREIGN KEY ("from_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_aspects" ADD CONSTRAINT "post_aspects_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_aspects" ADD CONSTRAINT "post_aspects_aspect_id_aspects_id_fk" FOREIGN KEY ("aspect_id") REFERENCES "public"."aspects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_audiences" ADD CONSTRAINT "post_audiences_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_audiences" ADD CONSTRAINT "post_audiences_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_follows" ADD CONSTRAINT "tag_follows_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_follows" ADD CONSTRAINT "tag_follows_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tombstones" ADD CONSTRAINT "tombstones_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aspect_memberships_actor_idx" ON "aspect_memberships" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "aspects_owner_name_idx" ON "aspects" USING btree ("owner_actor_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_pair_idx" ON "blocks" USING btree ("actor_id","target_actor_id");--> statement-breakpoint
CREATE INDEX "blocks_target_idx" ON "blocks" USING btree ("target_actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_requests_pair_idx" ON "follow_requests" USING btree ("actor_id","target_actor_id");--> statement-breakpoint
CREATE INDEX "follow_requests_target_idx" ON "follow_requests" USING btree ("target_actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follows_pair_idx" ON "follows" USING btree ("actor_id","target_actor_id");--> statement-breakpoint
CREATE INDEX "follows_target_idx" ON "follows" USING btree ("target_actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "likes_pair_idx" ON "likes" USING btree ("actor_id","post_id");--> statement-breakpoint
CREATE INDEX "likes_post_idx" ON "likes" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "media_attachments_post_idx" ON "media_attachments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "media_attachments_actor_idx" ON "media_attachments" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "mentions_actor_idx" ON "mentions" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mutes_pair_idx" ON "mutes" USING btree ("actor_id","target_actor_id");--> statement-breakpoint
CREATE INDEX "notifications_actor_idx" ON "notifications" USING btree ("actor_id","id");--> statement-breakpoint
CREATE INDEX "post_aspects_aspect_idx" ON "post_aspects" USING btree ("aspect_id");--> statement-breakpoint
CREATE INDEX "post_audiences_actor_idx" ON "post_audiences" USING btree ("actor_id","post_id");--> statement-breakpoint
CREATE INDEX "post_tags_tag_idx" ON "post_tags" USING btree ("tag_id","post_id");--> statement-breakpoint
CREATE INDEX "posts_actor_idx" ON "posts" USING btree ("actor_id","id");--> statement-breakpoint
CREATE INDEX "posts_reply_idx" ON "posts" USING btree ("in_reply_to_id");--> statement-breakpoint
CREATE INDEX "posts_thread_idx" ON "posts" USING btree ("thread_root_id");--> statement-breakpoint
CREATE INDEX "posts_reblog_idx" ON "posts" USING btree ("reblog_of_id");--> statement-breakpoint
CREATE INDEX "posts_public_local_idx" ON "posts" USING btree ("id") WHERE "posts"."visibility" = 'public' and "posts"."local";--> statement-breakpoint
CREATE INDEX "posts_public_idx" ON "posts" USING btree ("id") WHERE "posts"."visibility" = 'public';--> statement-breakpoint
CREATE UNIQUE INDEX "posts_ap_uri_idx" ON "posts" USING btree ("ap_uri");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_diaspora_guid_idx" ON "posts" USING btree ("diaspora_guid");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_reblog_unique_idx" ON "posts" USING btree ("actor_id","reblog_of_id") WHERE "posts"."reblog_of_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_idx" ON "tags" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "tombstones_uri_idx" ON "tombstones" USING btree ("uri");