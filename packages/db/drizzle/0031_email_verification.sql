ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
-- Accounts that existed before verification are treated as confirmed.
UPDATE "users" SET "email_verified_at" = now();
