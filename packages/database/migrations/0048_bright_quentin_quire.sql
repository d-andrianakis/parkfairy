-- Phase 5A.1: how to find and get into a space, what a listing offers for a car's safety, and the
-- largest vehicle each space takes. Arrival instructions are private (they can hold a gate code):
-- only the driver of a booking that stands reads them. A limit left null is no stated limit, which
-- fits any vehicle. Sizes are whole centimetres within what a car park can hold. Nothing here
-- changes a row that exists, so it needs no backfill.
ALTER TABLE "parking_locations" ADD COLUMN "arrival_instructions" text;--> statement-breakpoint
ALTER TABLE "parking_locations" ADD COLUMN "has_cctv" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_locations" ADD COLUMN "is_lit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_locations" ADD COLUMN "is_gated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "max_height_cm" smallint;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "max_length_cm" smallint;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "max_width_cm" smallint;--> statement-breakpoint
ALTER TABLE "parking_locations" ADD CONSTRAINT "parking_locations_arrival_instructions_check" CHECK ("parking_locations"."arrival_instructions" is null or char_length("parking_locations"."arrival_instructions") between 1 and 1000);--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD CONSTRAINT "parking_spaces_size_check" CHECK (("parking_spaces"."max_height_cm" is null or "parking_spaces"."max_height_cm" between 100 and 500) and ("parking_spaces"."max_length_cm" is null or "parking_spaces"."max_length_cm" between 200 and 1500) and ("parking_spaces"."max_width_cm" is null or "parking_spaces"."max_width_cm" between 100 and 400));