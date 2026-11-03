CREATE TABLE "owner_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text,
	"first_name" text,
	"last_name" text,
	"legal_name" text,
	"phone" text,
	"address_line" text,
	"city" text,
	"postal_code" text,
	"country" char(2) DEFAULT 'GR' NOT NULL,
	"tax_country" char(2) DEFAULT 'GR' NOT NULL,
	"tax_id_encrypted" text,
	"vat_id_encrypted" text,
	"registration_number_encrypted" text,
	"birth_date_encrypted" text,
	"verification" text DEFAULT 'unverified' NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "owner_profiles_kind_check" CHECK ("owner_profiles"."kind" is null or "owner_profiles"."kind" in ('individual', 'business')),
	CONSTRAINT "owner_profiles_country_check" CHECK ("owner_profiles"."country" in ('AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK')),
	CONSTRAINT "owner_profiles_tax_country_check" CHECK ("owner_profiles"."tax_country" in ('AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK')),
	CONSTRAINT "owner_profiles_verification_check" CHECK ("owner_profiles"."verification" in ('unverified', 'pending', 'verified', 'rejected')),
	CONSTRAINT "owner_profiles_text_length_check" CHECK (("owner_profiles"."first_name" is null or char_length("owner_profiles"."first_name") <= 100) and ("owner_profiles"."last_name" is null or char_length("owner_profiles"."last_name") <= 100) and ("owner_profiles"."legal_name" is null or char_length("owner_profiles"."legal_name") <= 200) and ("owner_profiles"."phone" is null or char_length("owner_profiles"."phone") <= 20) and ("owner_profiles"."address_line" is null or char_length("owner_profiles"."address_line") <= 200) and ("owner_profiles"."city" is null or char_length("owner_profiles"."city") <= 100) and ("owner_profiles"."postal_code" is null or char_length("owner_profiles"."postal_code") <= 12))
);
--> statement-breakpoint
CREATE TABLE "parking_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"alt" text,
	"color" char(7) NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parking_photos_location_key_unique" UNIQUE("location_id","key"),
	CONSTRAINT "parking_photos_key_check" CHECK ("parking_photos"."key" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "parking_photos_size_check" CHECK ("parking_photos"."width" > 0 and "parking_photos"."height" > 0),
	CONSTRAINT "parking_photos_alt_check" CHECK ("parking_photos"."alt" is null or char_length("parking_photos"."alt") <= 160),
	CONSTRAINT "parking_photos_color_check" CHECK ("parking_photos"."color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "parking_photos_position_check" CHECK ("parking_photos"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "parking_price_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"hourly_rate_minor" integer NOT NULL,
	"from_minute" smallint,
	"to_minute" smallint,
	"starts_on" date,
	"ends_on" date,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parking_price_rules_kind_check" CHECK ("parking_price_rules"."kind" in ('weekend', 'night', 'dated')),
	CONSTRAINT "parking_price_rules_rate_check" CHECK ("parking_price_rules"."hourly_rate_minor" > 0),
	CONSTRAINT "parking_price_rules_night_check" CHECK (("parking_price_rules"."kind" = 'night') = ("parking_price_rules"."from_minute" is not null and "parking_price_rules"."to_minute" is not null) and ("parking_price_rules"."from_minute" is null or ("parking_price_rules"."from_minute" between 0 and 1439 and "parking_price_rules"."to_minute" between 0 and 1439 and "parking_price_rules"."from_minute" <> "parking_price_rules"."to_minute"))),
	CONSTRAINT "parking_price_rules_dated_check" CHECK (("parking_price_rules"."kind" = 'dated') = ("parking_price_rules"."starts_on" is not null and "parking_price_rules"."ends_on" is not null) and ("parking_price_rules"."starts_on" is null or "parking_price_rules"."starts_on" <= "parking_price_rules"."ends_on")),
	CONSTRAINT "parking_price_rules_label_check" CHECK ("parking_price_rules"."label" is null or char_length("parking_price_rules"."label") <= 80)
);
--> statement-breakpoint
CREATE TABLE "parking_proof_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parking_proof_documents_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "parking_proof_documents_kind_check" CHECK ("parking_proof_documents"."kind" in ('titleDeed', 'lease', 'operatingLicence', 'other')),
	CONSTRAINT "parking_proof_documents_content_type_check" CHECK ("parking_proof_documents"."content_type" in ('application/pdf', 'image/jpeg', 'image/png')),
	CONSTRAINT "parking_proof_documents_size_check" CHECK ("parking_proof_documents"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "parking_stay_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"min_days" smallint NOT NULL,
	"percent" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parking_stay_discounts_location_days_unique" UNIQUE("location_id","min_days"),
	CONSTRAINT "parking_stay_discounts_days_check" CHECK ("parking_stay_discounts"."min_days" between 1 and 30),
	CONSTRAINT "parking_stay_discounts_percent_check" CHECK ("parking_stay_discounts"."percent" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "email_outbox_kind_check" CHECK ("email_outbox"."kind" in ('listing-submitted', 'listing-approved', 'listing-changes-requested', 'onboarding-reminder')),
	CONSTRAINT "email_outbox_status_check" CHECK ("email_outbox"."status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "parking_locations" DROP CONSTRAINT "parking_locations_status_check";--> statement-breakpoint
ALTER TABLE "parking_locations" DROP CONSTRAINT "parking_locations_text_length_check";--> statement-breakpoint
ALTER TABLE "parking_locations" DROP CONSTRAINT "parking_locations_area_check";--> statement-breakpoint
ALTER TABLE "parking_locations" DROP CONSTRAINT "parking_locations_hourly_rate_check";--> statement-breakpoint
ALTER TABLE "parking_locations" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_locations" ALTER COLUMN "address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_locations" ALTER COLUMN "area_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_locations" ALTER COLUMN "location" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_locations" ALTER COLUMN "hourly_rate_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_locations" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "parking_locations" ADD COLUMN "booking_gap_minutes" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_locations" ADD COLUMN "cancellation_policy" text;--> statement-breakpoint
ALTER TABLE "parking_locations" ADD COLUMN "land_registration_number" text;--> statement-breakpoint
ALTER TABLE "parking_locations" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "parking_locations" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parking_locations" ADD COLUMN "notified_status" text;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD COLUMN "hourly_rate_minor" integer;--> statement-breakpoint
ALTER TABLE "owner_profiles" ADD CONSTRAINT "owner_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_photos" ADD CONSTRAINT "parking_photos_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_price_rules" ADD CONSTRAINT "parking_price_rules_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_proof_documents" ADD CONSTRAINT "parking_proof_documents_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_stay_discounts" ADD CONSTRAINT "parking_stay_discounts_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_profiles_reminder_idx" ON "owner_profiles" USING btree ("updated_at") WHERE "owner_profiles"."reminder_sent_at" is null;--> statement-breakpoint
CREATE INDEX "parking_photos_location_position_idx" ON "parking_photos" USING btree ("location_id","position");--> statement-breakpoint
CREATE INDEX "parking_price_rules_location_idx" ON "parking_price_rules" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parking_price_rules_one_weekly_idx" ON "parking_price_rules" USING btree ("location_id","kind") WHERE "parking_price_rules"."kind" in ('weekend', 'night');--> statement-breakpoint
CREATE INDEX "parking_proof_documents_location_idx" ON "parking_proof_documents" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("next_attempt_at") WHERE "email_outbox"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "parking_locations" ADD CONSTRAINT "parking_locations_owner_id_owner_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parking_locations_owner_idx" ON "parking_locations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "parking_locations_status_email_idx" ON "parking_locations" USING btree ("updated_at") WHERE "parking_locations"."owner_id" is not null and "parking_locations"."status" in ('in_review', 'changes_requested', 'published') and "parking_locations"."notified_status" is distinct from "parking_locations"."status";--> statement-breakpoint
ALTER TABLE "parking_locations" ADD CONSTRAINT "parking_locations_complete_check" CHECK ("parking_locations"."status" in ('draft', 'changes_requested') or ("parking_locations"."name" is not null and "parking_locations"."address" is not null and "parking_locations"."area_id" is not null and "parking_locations"."location" is not null and "parking_locations"."hourly_rate_minor" is not null));--> statement-breakpoint
ALTER TABLE "parking_locations" ADD CONSTRAINT "parking_locations_booking_gap_check" CHECK ("parking_locations"."booking_gap_minutes" in (0, 30, 60));--> statement-breakpoint
ALTER TABLE "parking_locations" ADD CONSTRAINT "parking_locations_cancellation_policy_check" CHECK ("parking_locations"."cancellation_policy" is null or "parking_locations"."cancellation_policy" in ('oneHour', 'oneDay', 'oneDayThenHalf'));--> statement-breakpoint
ALTER TABLE "parking_locations" ADD CONSTRAINT "parking_locations_review_note_check" CHECK ("parking_locations"."review_note" is null or char_length("parking_locations"."review_note") <= 2000);--> statement-breakpoint
ALTER TABLE "parking_locations" ADD CONSTRAINT "parking_locations_land_registration_check" CHECK ("parking_locations"."land_registration_number" is null or char_length("parking_locations"."land_registration_number") <= 30);--> statement-breakpoint
ALTER TABLE "parking_locations" ADD CONSTRAINT "parking_locations_status_check" CHECK ("parking_locations"."status" in ('draft', 'in_review', 'changes_requested', 'published', 'suspended'));--> statement-breakpoint
ALTER TABLE "parking_locations" ADD CONSTRAINT "parking_locations_text_length_check" CHECK (("parking_locations"."name" is null or char_length("parking_locations"."name") between 1 and 120) and ("parking_locations"."address" is null or char_length("parking_locations"."address") between 1 and 200) and ("parking_locations"."description" is null or char_length("parking_locations"."description") <= 2000));--> statement-breakpoint
ALTER TABLE "parking_locations" ADD CONSTRAINT "parking_locations_area_check" CHECK ("parking_locations"."area_id" is null or "parking_locations"."area_id" in ('syntagma', 'monastiraki', 'kolonaki', 'koukaki', 'piraeusPort', 'glyfada', 'marousi', 'athensAirport', 'thessalonikiCentre', 'ladadika', 'thessalonikiAirport'));--> statement-breakpoint
ALTER TABLE "parking_locations" ADD CONSTRAINT "parking_locations_hourly_rate_check" CHECK ("parking_locations"."hourly_rate_minor" is null or "parking_locations"."hourly_rate_minor" > 0);--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD CONSTRAINT "parking_spaces_hourly_rate_check" CHECK ("parking_spaces"."hourly_rate_minor" is null or "parking_spaces"."hourly_rate_minor" > 0);