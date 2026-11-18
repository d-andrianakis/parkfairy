-- Phase 5A: a booking that carries on from another (an extended stay, the next period of a monthly
-- booking): it starts where its parent ends, on the same space for the same driver, which the
-- service keeps true. Never itself; at most one *live* continuation per booking (a hold or a booking
-- that stands: the statuses that take a space), so one that lapsed or was cancelled stays as history
-- without blocking the next try. NO ACTION, not RESTRICT, so a chain can be deleted in one
-- statement. Nothing here changes a booking that exists, so it needs no backfill.
ALTER TABLE "bookings" ADD COLUMN "continues_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_continues_booking_id_bookings_id_fk" FOREIGN KEY ("continues_booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_continues_idx" ON "bookings" USING btree ("continues_booking_id") WHERE "bookings"."continues_booking_id" is not null and "bookings"."status" in ('held', 'confirmed');--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_continues_check" CHECK ("bookings"."continues_booking_id" is null or "bookings"."continues_booking_id" <> "bookings"."id");