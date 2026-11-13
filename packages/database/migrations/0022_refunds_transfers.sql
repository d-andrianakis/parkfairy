-- Phase 4.2: a cancellation's refund and the owner's transfer on each booking, the charge they
-- hang off, and the ledger of what moved. The worker's sweeps each have a partial index. Columns
-- are nullable (nothing to backfill: no booking was paid for before 0021).
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"stripe_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_kind_check" CHECK ("ledger_entries"."kind" in ('charge', 'refund', 'commission', 'transfer')),
	CONSTRAINT "ledger_entries_amount_check" CHECK ("ledger_entries"."amount_minor" > 0),
	CONSTRAINT "ledger_entries_currency_check" CHECK ("ledger_entries"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_payment_check";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "stripe_charge_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "refund_status" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "stripe_refund_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "transfer_status" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "transfer_minor" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "commission_minor" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "stripe_transfer_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "transferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_booking_kind_idx" ON "ledger_entries" USING btree ("booking_id","kind");--> statement-breakpoint
CREATE INDEX "bookings_refunds_owed_idx" ON "bookings" USING btree ("updated_at") WHERE "bookings"."refund_status" = 'owed' or "bookings"."payment_status" = 'refunding';--> statement-breakpoint
CREATE INDEX "bookings_transfers_due_idx" ON "bookings" USING btree ("ends_at") WHERE "bookings"."payment_status" = 'succeeded' and "bookings"."status" in ('confirmed', 'cancelled') and ("bookings"."transfer_status" is null or "bookings"."transfer_status" = 'sending');--> statement-breakpoint
CREATE INDEX "bookings_lapsed_payments_idx" ON "bookings" USING btree ("updated_at") WHERE "bookings"."payment_status" = 'pending' and "bookings"."status" in ('expired', 'released');--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_refund_status_check" CHECK ("bookings"."refund_status" is null or ("bookings"."refund_status" in ('owed', 'sent') and "bookings"."status" = 'cancelled' and "bookings"."refund_minor" > 0 and ("bookings"."refund_status" = 'sent') = ("bookings"."stripe_refund_id" is not null)));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_transfer_check" CHECK ("bookings"."transfer_status" is null or ("bookings"."transfer_status" in ('sending', 'sent') and "bookings"."transfer_minor" > 0 and "bookings"."commission_minor" >= 0 and ("bookings"."transfer_status" = 'sent') = ("bookings"."stripe_transfer_id" is not null and "bookings"."transferred_at" is not null)));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_check" CHECK (("bookings"."payment_intent_id" is null) = ("bookings"."payment_status" is null) and ("bookings"."payment_status" is null or "bookings"."payment_status" in ('pending', 'processing', 'succeeded', 'refunding', 'refunded', 'canceled')));