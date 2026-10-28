-- PostGIS: geospatial search and distance ordering for parking locations.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
-- btree_gist: lets exclusion constraints combine equality (unit id) with range overlap
-- (reserved interval), which is how double-booking of inventory units is prevented.
CREATE EXTENSION IF NOT EXISTS btree_gist;
