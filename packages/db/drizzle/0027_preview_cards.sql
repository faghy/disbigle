CREATE TABLE "post_cards" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"card_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preview_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"site_name" text DEFAULT '' NOT NULL,
	"image_path" text,
	"image_width" integer,
	"image_height" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preview_cards_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "post_cards" ADD CONSTRAINT "post_cards_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_cards" ADD CONSTRAINT "post_cards_card_id_preview_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."preview_cards"("id") ON DELETE set null ON UPDATE no action;