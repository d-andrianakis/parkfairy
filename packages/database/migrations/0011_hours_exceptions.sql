CREATE TABLE "parking_hours_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"opens_minute" smallint,
	"closes_minute" smallint,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parking_hours_exceptions_range_check" CHECK ("parking_hours_exceptions"."starts_on" <= "parking_hours_exceptions"."ends_on"),
	CONSTRAINT "parking_hours_exceptions_period_check" CHECK (("parking_hours_exceptions"."opens_minute" is null) = ("parking_hours_exceptions"."closes_minute" is null) and ("parking_hours_exceptions"."opens_minute" is null or ("parking_hours_exceptions"."opens_minute" >= 0 and "parking_hours_exceptions"."closes_minute" <= 1440 and "parking_hours_exceptions"."opens_minute" < "parking_hours_exceptions"."closes_minute" and "parking_hours_exceptions"."opens_minute" % 30 = 0 and "parking_hours_exceptions"."closes_minute" % 30 = 0))),
	CONSTRAINT "parking_hours_exceptions_label_check" CHECK ("parking_hours_exceptions"."label" is null or char_length("parking_hours_exceptions"."label") <= 80)
);
--> statement-breakpoint
ALTER TABLE "parking_hours_exceptions" ADD CONSTRAINT "parking_hours_exceptions_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parking_hours_exceptions_location_ends_idx" ON "parking_hours_exceptions" USING btree ("location_id","ends_on");