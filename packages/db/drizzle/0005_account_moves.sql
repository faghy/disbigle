ALTER TABLE "actors" ADD COLUMN "also_known_as" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "moved_to_actor_id" uuid;