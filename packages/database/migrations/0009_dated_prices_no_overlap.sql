-- Two dated prices of one listing must not cover the same day, or "the most specific wins" has
-- no answer. Both ends are included, hence '[]'. btree_gist (0000) provides = for the uuid column
-- inside the GiST exclusion constraint.
ALTER TABLE "parking_price_rules" ADD CONSTRAINT "parking_price_rules_dated_no_overlap"
  EXCLUDE USING gist (
    "location_id" WITH =,
    daterange("starts_on", "ends_on", '[]') WITH &&
  ) WHERE ("kind" = 'dated');
