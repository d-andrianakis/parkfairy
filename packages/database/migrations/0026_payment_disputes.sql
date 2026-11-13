-- Phase 4.3: disputes of a booking's payment (#57-#60), as Stripe last told us: the evidence
-- staged at Stripe when one opens, and an open or lost one holding the booking's payout. A
-- financial record (no cascade).
CREATE TABLE "payment_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"stripe_dispute_id" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"due_by" timestamp with time zone,
	"submissions" integer DEFAULT 0 NOT NULL,
	"evidence_staged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_disputes_stripe_dispute_id_unique" UNIQUE("stripe_dispute_id"),
	CONSTRAINT "payment_disputes_status_check" CHECK ("payment_disputes"."status" in ('warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'prevented')),
	CONSTRAINT "payment_disputes_amount_check" CHECK ("payment_disputes"."amount_minor" > 0),
	CONSTRAINT "payment_disputes_currency_check" CHECK ("payment_disputes"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_disputes_submissions_check" CHECK ("payment_disputes"."submissions" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_disputes_booking_idx" ON "payment_disputes" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payment_disputes_open_idx" ON "payment_disputes" USING btree ("due_by") WHERE "payment_disputes"."status" in ('needs_response', 'warning_needs_response');