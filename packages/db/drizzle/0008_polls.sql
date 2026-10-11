CREATE TABLE "poll_votes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"poll_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"choice" integer NOT NULL,
	"ap_uri" text,
	"diaspora_guid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"options" jsonb NOT NULL,
	"multiple" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"voters_count" integer DEFAULT 0 NOT NULL,
	"diaspora_guid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_votes_unique_idx" ON "poll_votes" USING btree ("poll_id","actor_id","choice");--> statement-breakpoint
CREATE INDEX "poll_votes_actor_idx" ON "poll_votes" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "polls_post_idx" ON "polls" USING btree ("post_id");