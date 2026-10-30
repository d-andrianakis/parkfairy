CREATE INDEX "users_unconfirmed_created_at_idx" ON "users" USING btree ("created_at") WHERE not "users"."email_verified";--> statement-breakpoint
CREATE INDEX "verifications_expires_at_idx" ON "verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "verifications_value_idx" ON "verifications" USING btree ("value");