-- Co-ownership, after review: the invite limits (per address per listing, per inviter per day)
-- read these; they serve the cascade from a deleted listing and the SET NULL from a profile too.
CREATE INDEX "listing_invites_listing_email_idx" ON "listing_invites" USING btree ("location_id","email","created_at");--> statement-breakpoint
CREATE INDEX "listing_invites_inviter_idx" ON "listing_invites" USING btree ("invited_by","created_at");