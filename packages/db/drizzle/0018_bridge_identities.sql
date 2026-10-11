CREATE TABLE "bridge_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"username" text NOT NULL,
	"diaspora_guid" text NOT NULL,
	"public_key_pem" text NOT NULL,
	"private_key_pem" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bridge_identities" ADD CONSTRAINT "bridge_identities_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_identities_actor_idx" ON "bridge_identities" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_identities_username_idx" ON "bridge_identities" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_identities_guid_idx" ON "bridge_identities" USING btree ("diaspora_guid");