-- Two rows that take a space must not overlap on it: this, not a read before the insert, is what
-- stops two drivers booking one space (decision #9). A hold takes the space as a booking does;
-- the owner's gap after each stay counts as taken (decision #10), hence `blocked_until`. Ranges are
-- half-open, so a stay ending at 12:00 sits next to one starting at 12:00 when there is no gap.
-- A hold past its time still counts until it is marked expired: the hold transaction marks the
-- space's lapsed holds first, and the worker sweeps the rest every minute. btree_gist (0000)
-- provides = for the uuid column inside the GiST exclusion constraint.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_space_no_overlap"
  EXCLUDE USING gist (
    "space_id" WITH =,
    tstzrange("starts_at", "blocked_until", '[)') WITH &&
  ) WHERE ("status" in ('held', 'confirmed'));
