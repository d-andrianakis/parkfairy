DROP INDEX "owner_profiles_reminder_idx";--> statement-breakpoint
CREATE INDEX "parking_photos_key_idx" ON "parking_photos" USING btree ("key");--> statement-breakpoint
CREATE INDEX "email_outbox_user_idx" ON "email_outbox" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "owner_profiles_reminder_idx" ON "owner_profiles" USING btree ("updated_at") WHERE "owner_profiles"."reminder_sent_at" is null and "owner_profiles"."verification" = 'unverified';