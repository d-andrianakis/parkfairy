-- The listing's name, address and language, kept on each booking (L6, decision #43). Existing
-- bookings take what the listing says now: the best there is. Added empty, filled, then required,
-- as a NOT NULL column can't be added to rows that exist.
ALTER TABLE "bookings" ADD COLUMN "listing_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "listing_address" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "listing_locale" text;--> statement-breakpoint
UPDATE "bookings" SET "listing_name" = l."name", "listing_address" = l."address", "listing_locale" = l."content_locale" FROM "parking_locations" l WHERE l."id" = "bookings"."location_id";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "listing_locale" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listing_locale_check" CHECK ("bookings"."listing_locale" in ('el', 'en'));
