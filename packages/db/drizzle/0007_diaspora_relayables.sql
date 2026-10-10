CREATE TABLE "diaspora_relayables" (
	"guid" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"parent_guid" text NOT NULL,
	"author" text NOT NULL,
	"xml" text NOT NULL,
	"post_id" uuid,
	"like_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diaspora_relayables" ADD CONSTRAINT "diaspora_relayables_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_relayables" ADD CONSTRAINT "diaspora_relayables_like_id_likes_id_fk" FOREIGN KEY ("like_id") REFERENCES "public"."likes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diaspora_relayables_parent_idx" ON "diaspora_relayables" USING btree ("parent_guid");