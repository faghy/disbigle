CREATE TABLE "domain_block_exceptions" (
	"domain" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_blocks" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "domain_blocks" ADD COLUMN "obfuscate" boolean DEFAULT false NOT NULL;