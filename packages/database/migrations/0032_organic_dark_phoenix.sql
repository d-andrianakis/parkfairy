DROP INDEX "booking_payees_owner_open_idx";--> statement-breakpoint
CREATE INDEX "booking_payees_owner_sending_idx" ON "booking_payees" USING btree ("owner_id") WHERE "booking_payees"."transfer_status" = 'sending';--> statement-breakpoint
CREATE INDEX "booking_payees_owner_open_idx" ON "booking_payees" USING btree ("owner_id") WHERE "booking_payees"."transfer_status" is null;