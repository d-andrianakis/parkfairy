/**
 * What a driver keeps for next time (Phase 5A.2): the vehicles they park, and the listings they
 * favour. Both are the driver's own and nobody else reads them; a booking copies the plate it is
 * made for, so deleting a saved vehicle never rewrites one. They go with the account, unlike a
 * booking, which the account's deletion must wait for (Phase 6).
 */
import { SPACE_LIMITS_CM, VEHICLE_LIMITS, VEHICLE_PLATE_LIMITS } from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { parkingLocations } from './parking.js';

const limit = (value: number) => sql.raw(String(value));
const instant = (name: string) => timestamp(name, { withTimezone: true });

export const savedVehicles = pgTable(
  'saved_vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Normalized (`IKB1234`), as a booking keeps it. Personal data: Phase 6 sets how long. */
    plate: text('plate').notNull(),
    /** A nickname the driver chose ("Work car"): free text, shown only to them. */
    name: text('name'),
    heightCm: smallint('height_cm'),
    lengthCm: smallint('length_cm'),
    widthCm: smallint('width_cm'),
    createdAt: instant('created_at').defaultNow().notNull(),
    updatedAt: instant('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // One entry per car, and the driver's list in the order they saved them.
    unique('saved_vehicles_user_plate_unique').on(t.userId, t.plate),
    index('saved_vehicles_user_created_idx').on(t.userId, t.createdAt),
    check(
      'saved_vehicles_plate_check',
      sql`${t.plate} ~ ${sql.raw(`'^[A-Z0-9]{${VEHICLE_PLATE_LIMITS.min},${VEHICLE_PLATE_LIMITS.max}}$'`)}`,
    ),
    check(
      'saved_vehicles_name_check',
      sql`${t.name} is null or char_length(${t.name}) between 1 and ${limit(VEHICLE_LIMITS.name)}`,
    ),
    check(
      'saved_vehicles_size_check',
      sql`(${t.heightCm} is null or ${t.heightCm} between ${limit(SPACE_LIMITS_CM.height.min)} and ${limit(SPACE_LIMITS_CM.height.max)}) and (${t.lengthCm} is null or ${t.lengthCm} between ${limit(SPACE_LIMITS_CM.length.min)} and ${limit(SPACE_LIMITS_CM.length.max)}) and (${t.widthCm} is null or ${t.widthCm} between ${limit(SPACE_LIMITS_CM.width.min)} and ${limit(SPACE_LIMITS_CM.width.max)})`,
    ),
  ],
);

export const favouriteListings = pgTable(
  'favourite_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Cascades: a favourite is no record worth keeping once its listing is deleted. */
    locationId: uuid('location_id')
      .notNull()
      .references(() => parkingLocations.id, { onDelete: 'cascade' }),
    createdAt: instant('created_at').defaultNow().notNull(),
  },
  (t) => [
    // Also answers "is this listing a favourite of this driver?".
    unique('favourite_listings_user_location_unique').on(t.userId, t.locationId),
    // The driver's list, newest first (`id` last, so equal instants keep one order).
    index('favourite_listings_user_created_idx').on(t.userId, t.createdAt.desc(), t.id),
    // Deleting a listing finds its favourites.
    index('favourite_listings_location_idx').on(t.locationId),
  ],
);
