CREATE TABLE "listing_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_invites" ADD COLUMN "role" text DEFAULT 'co_owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_managers" ADD CONSTRAINT "listing_managers_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_managers" ADD CONSTRAINT "listing_managers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_managers_listing_user_idx" ON "listing_managers" USING btree ("location_id","user_id");--> statement-breakpoint
CREATE INDEX "listing_managers_user_idx" ON "listing_managers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "listing_invites" ADD CONSTRAINT "listing_invites_role_check" CHECK ("listing_invites"."role" in ('co_owner', 'manager'));