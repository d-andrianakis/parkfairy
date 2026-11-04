-- Two closures or special hours of one listing must not cover the same day, or that day has two
-- answers. Both ends are included, hence '[]', as for dated prices (0009).
ALTER TABLE "parking_hours_exceptions" ADD CONSTRAINT "parking_hours_exceptions_no_overlap"
  EXCLUDE USING gist (
    "location_id" WITH =,
    daterange("starts_on", "ends_on", '[]') WITH &&
  );
