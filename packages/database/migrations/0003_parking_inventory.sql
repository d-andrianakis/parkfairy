CREATE TABLE "parking_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"address" text NOT NULL,
	"area_id" text NOT NULL,
	"content_locale" text DEFAULT 'el' NOT NULL,
	"location" geography(Point,4326) NOT NULL,
	"time_zone" text DEFAULT 'Europe/Athens' NOT NULL,
	"hourly_rate_minor" integer NOT NULL,
	"daily_max_minor" integer,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parking_locations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "parking_locations_status_check" CHECK ("parking_locations"."status" in ('draft', 'published', 'suspended')),
	CONSTRAINT "parking_locations_area_check" CHECK ("parking_locations"."area_id" in ('syntagma', 'monastiraki', 'kolonaki', 'koukaki', 'piraeusPort', 'glyfada', 'marousi', 'athensAirport', 'thessalonikiCentre', 'ladadika', 'thessalonikiAirport')),
	CONSTRAINT "parking_locations_content_locale_check" CHECK ("parking_locations"."content_locale" in ('el', 'en')),
	CONSTRAINT "parking_locations_currency_check" CHECK ("parking_locations"."currency" in ('EUR')),
	CONSTRAINT "parking_locations_hourly_rate_check" CHECK ("parking_locations"."hourly_rate_minor" > 0),
	CONSTRAINT "parking_locations_daily_max_check" CHECK ("parking_locations"."daily_max_minor" is null or "parking_locations"."daily_max_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "parking_opening_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_minute" smallint NOT NULL,
	"closes_minute" smallint NOT NULL,
	CONSTRAINT "parking_opening_hours_weekday_check" CHECK ("parking_opening_hours"."weekday" between 1 and 7),
	CONSTRAINT "parking_opening_hours_period_check" CHECK ("parking_opening_hours"."opens_minute" >= 0 and "parking_opening_hours"."closes_minute" <= 1440 and "parking_opening_hours"."opens_minute" < "parking_opening_hours"."closes_minute")
);
--> statement-breakpoint
CREATE TABLE "parking_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"label" text NOT NULL,
	"is_covered" boolean DEFAULT false NOT NULL,
	"has_ev_charging" boolean DEFAULT false NOT NULL,
	"is_accessible" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parking_spaces_location_label_unique" UNIQUE("location_id","label")
);
--> statement-breakpoint
ALTER TABLE "parking_opening_hours" ADD CONSTRAINT "parking_opening_hours_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_spaces" ADD CONSTRAINT "parking_spaces_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parking_locations_location_idx" ON "parking_locations" USING gist ("location");--> statement-breakpoint
CREATE INDEX "parking_locations_published_idx" ON "parking_locations" USING btree ("slug") WHERE "parking_locations"."status" = 'published';--> statement-breakpoint
CREATE INDEX "parking_opening_hours_location_idx" ON "parking_opening_hours" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "parking_spaces_location_active_idx" ON "parking_spaces" USING btree ("location_id") WHERE "parking_spaces"."is_active";