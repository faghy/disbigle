CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"params" jsonb NOT NULL,
	"claimed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_posts_due_idx" ON "scheduled_posts" USING btree ("scheduled_at") WHERE "scheduled_posts"."failed_at" is null;--> statement-breakpoint
CREATE INDEX "scheduled_posts_actor_idx" ON "scheduled_posts" USING btree ("actor_id","scheduled_at");