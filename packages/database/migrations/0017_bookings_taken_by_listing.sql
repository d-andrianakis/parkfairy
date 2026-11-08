-- The worker's deletion of holds that never became bookings (deleteStaleHolds), a week on.
CREATE INDEX "bookings_stale_holds_idx" ON "bookings" USING btree ("updated_at") WHERE "bookings"."status" in ('expired', 'released');--> statement-breakpoint
-- Which spaces of a listing a stay meets, in one probe per listing rather than one per space:
-- search, the listing page and the closing-time guard ask it of a whole listing. The same predicate
-- and range as the exclusion constraint (0015), so a query that repeats them is served. Not built
-- CONCURRENTLY: migrations run in a transaction, and the table is empty where it matters today;
-- a later index on a full table should be.
CREATE INDEX "bookings_taken_by_listing_idx" ON "bookings" USING gist (
  "location_id",
  tstzrange("starts_at", "blocked_until", '[)')
) WHERE ("status" in ('held', 'confirmed'));
