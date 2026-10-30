-- Opening periods of one listing on the same weekday must not overlap. Ranges are half-open,
-- so 08:00–12:00 next to 12:00–16:00 is allowed. btree_gist (0000) provides = for the
-- uuid and smallint columns inside the GiST exclusion constraint.
ALTER TABLE "parking_opening_hours" ADD CONSTRAINT "parking_opening_hours_no_overlap"
  EXCLUDE USING gist (
    "location_id" WITH =,
    "weekday" WITH =,
    int4range("opens_minute", "closes_minute") WITH &&
  );
