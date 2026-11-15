CREATE TABLE "listing_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"from_owner_id" uuid NOT NULL,
	"to_owner_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_handovers_distinct_check" CHECK ("listing_handovers"."from_owner_id" <> "listing_handovers"."to_owner_id"),
	CONSTRAINT "listing_handovers_settled_check" CHECK ("listing_handovers"."accepted_at" is null or "listing_handovers"."withdrawn_at" is null)
);
--> statement-breakpoint
ALTER TABLE "listing_handovers" ADD CONSTRAINT "listing_handovers_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_handovers" ADD CONSTRAINT "listing_handovers_from_owner_id_owner_profiles_id_fk" FOREIGN KEY ("from_owner_id") REFERENCES "public"."owner_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_handovers" ADD CONSTRAINT "listing_handovers_to_owner_id_owner_profiles_id_fk" FOREIGN KEY ("to_owner_id") REFERENCES "public"."owner_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_handovers_open_idx" ON "listing_handovers" USING btree ("location_id") WHERE "listing_handovers"."accepted_at" is null and "listing_handovers"."withdrawn_at" is null;--> statement-breakpoint
CREATE INDEX "listing_handovers_to_idx" ON "listing_handovers" USING btree ("to_owner_id");--> statement-breakpoint
CREATE INDEX "listing_handovers_from_idx" ON "listing_handovers" USING btree ("from_owner_id");