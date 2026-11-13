-- Phase 4.2: a lapsed hold whose PaymentIntent the worker called off at Stripe can go like any
-- other (the stale-hold sweep's index takes it in), and the daily ledger check reads only what was
-- entered since its last run.
DROP INDEX "bookings_stale_holds_idx";--> statement-breakpoint
CREATE INDEX "ledger_entries_created_idx" ON "ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bookings_stale_holds_idx" ON "bookings" USING btree ("updated_at") WHERE "bookings"."status" in ('expired', 'released') and ("bookings"."payment_intent_id" is null or "bookings"."payment_status" = 'canceled');