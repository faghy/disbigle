ALTER TABLE "posts" ADD COLUMN "in_reply_to_uri" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ed25519_private_key_pem" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ed25519_public_key_pem" text;