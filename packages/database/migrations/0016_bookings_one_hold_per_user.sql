-- One hold per driver (our reading, memory.md): a new hold lets the driver's earlier ones go, but a
-- second press at the same moment can't see the first's uncommitted row, so the rule needs the
-- database. Rows from before it was enforced keep each driver's newest hold only.
UPDATE "bookings" AS b SET "status" = 'released', "updated_at" = now()
WHERE b."status" = 'held' AND EXISTS (
  SELECT 1 FROM "bookings" AS newer
  WHERE newer."user_id" = b."user_id" AND newer."status" = 'held'
    AND (newer."created_at", newer."id") > (b."created_at", b."id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_hold_per_user_idx" ON "bookings" USING btree ("user_id") WHERE "bookings"."status" = 'held';
