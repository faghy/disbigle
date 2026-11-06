CREATE TABLE "hidden_posts" (
	"actor_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_posts_actor_id_post_id_pk" PRIMARY KEY("actor_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "tag_hides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"target_actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hidden_posts" ADD CONSTRAINT "hidden_posts_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hidden_posts" ADD CONSTRAINT "hidden_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_hides" ADD CONSTRAINT "tag_hides_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_hides" ADD CONSTRAINT "tag_hides_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_hides" ADD CONSTRAINT "tag_hides_target_actor_id_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_hides_everyone_idx" ON "tag_hides" USING btree ("actor_id","tag_id") WHERE "tag_hides"."target_actor_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_hides_account_idx" ON "tag_hides" USING btree ("actor_id","tag_id","target_actor_id") WHERE "tag_hides"."target_actor_id" is not null;