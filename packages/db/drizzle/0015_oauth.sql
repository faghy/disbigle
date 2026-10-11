CREATE TABLE "oauth_access_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" text[] NOT NULL,
	"code_challenge" text,
	"code_challenge_method" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_access_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid,
	"token_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"redirect_uris" text[] DEFAULT '{}' NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_access_grants" ADD CONSTRAINT "oauth_access_grants_application_id_oauth_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."oauth_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_grants" ADD CONSTRAINT "oauth_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_application_id_oauth_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."oauth_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_access_grants_code_hash_idx" ON "oauth_access_grants" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "oauth_access_grants_expires_idx" ON "oauth_access_grants" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_access_tokens_token_hash_idx" ON "oauth_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_user_idx" ON "oauth_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_application_idx" ON "oauth_access_tokens" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_applications_client_id_idx" ON "oauth_applications" USING btree ("client_id");