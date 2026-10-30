CREATE TABLE "post_translations" (
	"post_id" uuid NOT NULL,
	"language" text NOT NULL,
	"source_hash" text NOT NULL,
	"source_language" text NOT NULL,
	"content_html" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_translations_post_id_language_pk" PRIMARY KEY("post_id","language")
);
--> statement-breakpoint
ALTER TABLE "post_translations" ADD CONSTRAINT "post_translations_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;