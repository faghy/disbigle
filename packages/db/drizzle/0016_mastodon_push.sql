ALTER TABLE "web_push_subscriptions" ADD COLUMN "token_id" uuid;--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD COLUMN "mastodon" jsonb;--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_token_id_oauth_access_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."oauth_access_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "web_push_subscriptions_token_idx" ON "web_push_subscriptions" USING btree ("token_id");