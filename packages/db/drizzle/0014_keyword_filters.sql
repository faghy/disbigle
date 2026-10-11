CREATE TYPE "public"."filter_context" AS ENUM('home', 'public', 'notifications', 'thread');--> statement-breakpoint
CREATE TABLE "keyword_filters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"phrase" text NOT NULL,
	"whole_word" boolean DEFAULT true NOT NULL,
	"contexts" "filter_context"[] NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "keyword_filters" ADD CONSTRAINT "keyword_filters_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "keyword_filters_actor_idx" ON "keyword_filters" USING btree ("actor_id");