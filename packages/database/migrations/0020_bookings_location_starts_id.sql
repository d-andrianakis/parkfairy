-- An owner's bookings page goes by `(starts_at, id)` places (keyset paging, 3.4): with the id in the
-- index the pair is an exact index condition and the order comes from the index, so the probe for
-- a page on either side reads a few buffers at any depth (performance review, 1.68M bookings). Every
-- other user of the old index (the closing-time guard, removing a draft, the foreign key's check)
-- reads a prefix of this one. Built plainly, before launch: migrations run in a transaction, so on a
-- full table this would be CREATE INDEX CONCURRENTLY and DROP INDEX CONCURRENTLY by hand instead.
CREATE INDEX "bookings_location_starts_id_idx" ON "bookings" USING btree ("location_id","starts_at","id");--> statement-breakpoint
DROP INDEX "bookings_location_starts_idx";
