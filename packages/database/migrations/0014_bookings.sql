CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"space_id" uuid,
	"space_label" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"gap_minutes" smallint NOT NULL,
	"blocked_until" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"hold_expires_at" timestamp with time zone NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"cancellation_policy" text NOT NULL,
	"vehicle_plate" text,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"refund_minor" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_reference_unique" UNIQUE("reference"),
	CONSTRAINT "bookings_status_check" CHECK ("bookings"."status" in ('held', 'confirmed', 'cancelled', 'expired', 'released')),
	CONSTRAINT "bookings_reference_check" CHECK ("bookings"."reference" ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
	CONSTRAINT "bookings_period_check" CHECK ("bookings"."starts_at" < "bookings"."ends_at"),
	CONSTRAINT "bookings_gap_check" CHECK ("bookings"."gap_minutes" in (0, 30, 60) and "bookings"."blocked_until" = "bookings"."ends_at" + make_interval(mins => "bookings"."gap_minutes")),
	CONSTRAINT "bookings_currency_check" CHECK ("bookings"."currency" in ('EUR')),
	CONSTRAINT "bookings_total_check" CHECK ("bookings"."total_minor" >= 0),
	CONSTRAINT "bookings_cancellation_policy_check" CHECK ("bookings"."cancellation_policy" in ('oneHour', 'oneDay', 'oneDayThenHalf')),
	CONSTRAINT "bookings_vehicle_plate_check" CHECK ("bookings"."vehicle_plate" is null or "bookings"."vehicle_plate" ~ '^[A-Z0-9]{2,10}$'),
	CONSTRAINT "bookings_confirmed_check" CHECK ("bookings"."status" not in ('confirmed', 'cancelled') or ("bookings"."vehicle_plate" is not null and "bookings"."confirmed_at" is not null)),
	CONSTRAINT "bookings_cancelled_check" CHECK (case when "bookings"."status" = 'cancelled' then "bookings"."cancelled_at" is not null and "bookings"."refund_minor" is not null and "bookings"."cancelled_by" in ('driver', 'owner') else "bookings"."cancelled_at" is null and "bookings"."cancelled_by" is null and "bookings"."refund_minor" is null end),
	CONSTRAINT "bookings_refund_check" CHECK ("bookings"."refund_minor" is null or "bookings"."refund_minor" between 0 and "bookings"."total_minor")
);
--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_space_id_parking_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."parking_spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_user_starts_idx" ON "bookings" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_location_starts_idx" ON "bookings" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_space_idx" ON "bookings" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "bookings_hold_expiry_idx" ON "bookings" USING btree ("hold_expires_at") WHERE "bookings"."status" = 'held';--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_check" CHECK ("email_outbox"."kind" in ('listing-submitted', 'listing-approved', 'listing-changes-requested', 'onboarding-reminder', 'booking-confirmed', 'booking-cancelled', 'booking-received', 'booking-cancelled-by-driver'));