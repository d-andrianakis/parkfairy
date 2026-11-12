-- Phase 4: payout accounts, the platform's settings (the commission, #15), Stripe events handled,
-- and a booking's commission and payment. Bookings already made get the 10% their owners agreed to;
-- from now on each hold copies the setting, so the column keeps no default.
CREATE TABLE "payout_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"stripe_account_id" text NOT NULL,
	"status" text DEFAULT 'restricted' NOT NULL,
	"status_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_accounts_owner_id_unique" UNIQUE("owner_id"),
	CONSTRAINT "payout_accounts_stripe_account_id_unique" UNIQUE("stripe_account_id"),
	CONSTRAINT "payout_accounts_status_check" CHECK ("payout_accounts"."status" in ('pending', 'restricted', 'active')),
	CONSTRAINT "payout_accounts_stripe_id_check" CHECK ("payout_accounts"."stripe_account_id" ~ '^acct_[A-Za-z0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"commission_bps" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "platform_settings_single_row_check" CHECK ("platform_settings"."singleton"),
	CONSTRAINT "platform_settings_commission_check" CHECK ("platform_settings"."commission_bps" between 0 and 10000)
);
--> statement-breakpoint
INSERT INTO "platform_settings" ("commission_bps") VALUES (1000);--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"type" text NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind_check";--> statement-breakpoint
DROP INDEX "bookings_stale_holds_idx";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "commission_bps" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "commission_bps" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_status" text;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_owner_id_owner_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_events_handled_idx" ON "stripe_events" USING btree ("handled_at");--> statement-breakpoint
CREATE INDEX "bookings_stale_holds_idx" ON "bookings" USING btree ("updated_at") WHERE "bookings"."status" in ('expired', 'released') and "bookings"."payment_intent_id" is null;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_intent_id_unique" UNIQUE("payment_intent_id");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_check" CHECK ("email_outbox"."kind" in ('listing-submitted', 'listing-approved', 'listing-changes-requested', 'onboarding-reminder', 'booking-confirmed', 'booking-cancelled', 'booking-payment-refunded', 'booking-received', 'booking-cancelled-by-driver'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_commission_check" CHECK ("bookings"."commission_bps" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_check" CHECK (("bookings"."payment_intent_id" is null) = ("bookings"."payment_status" is null) and ("bookings"."payment_status" is null or "bookings"."payment_status" in ('pending', 'processing', 'succeeded', 'refunding', 'refunded')));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_intent_check" CHECK ("bookings"."payment_intent_id" is null or "bookings"."payment_intent_id" ~ '^pi_[A-Za-z0-9]+$');