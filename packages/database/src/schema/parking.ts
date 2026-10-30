/**
 * Parking inventory: listings (facilities), their individually named spaces, and weekly
 * opening hours. Bookings (Phase 3) will reserve a space for a `[start, end)` interval.
 */
import {
  AREA_IDS,
  CURRENCIES,
  DEFAULT_TIME_ZONE,
  LISTING_LIMITS,
  SLUG_PATTERN,
  SUPPORTED_LOCALES,
  SUPPORTED_TIME_ZONES,
  type AreaId,
  type Locale,
} from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const LISTING_STATUSES = ['draft', 'published', 'suspended'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** `'a', 'b'` list for CHECK constraints built from trusted constants (never user input). */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * PostGIS `geography(Point, 4326)`: distances in metres on the spheroid, GiST-indexable.
 * Reads come back as hex EWKB.
 */
export const geographyPoint = customType<{ data: GeoPoint; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
  toDriver: ({ latitude, longitude }) =>
    sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`,
  fromDriver: (value) => parseEwkbPoint(value),
});

/** Decodes a hex (E)WKB point as returned by PostGIS. */
export function parseEwkbPoint(hex: string): GeoPoint {
  const bytes = Buffer.from(hex, 'hex');
  const littleEndian = bytes.readUInt8(0) === 1;
  const type = littleEndian ? bytes.readUInt32LE(1) : bytes.readUInt32BE(1);
  const hasSrid = (type & 0x20000000) !== 0;
  if ((type & 0xff) !== 1) throw new Error('Not a WKB point');
  const offset = hasSrid ? 9 : 5;
  const read = (at: number) => (littleEndian ? bytes.readDoubleLE(at) : bytes.readDoubleBE(at));
  return { longitude: read(offset), latitude: read(offset + 8) };
}

export const parkingLocations = pgTable(
  'parking_locations',
  {
    id: id(),
    /** URL key, e.g. `syntagma-square-garage`. */
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    address: text('address').notNull(),
    areaId: text('area_id').$type<AreaId>().notNull(),
    /** Language the owner wrote name, address and description in. */
    contentLocale: text('content_locale').$type<Locale>().notNull().default('el'),
    location: geographyPoint('location').notNull(),
    /** IANA zone the opening hours are written in. */
    timeZone: text('time_zone').notNull().default(DEFAULT_TIME_ZONE),
    hourlyRateMinor: integer('hourly_rate_minor').notNull(),
    dailyMaxMinor: integer('daily_max_minor'),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    status: text('status').$type<ListingStatus>().notNull().default('draft'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('parking_locations_location_idx').using('gist', t.location),
    index('parking_locations_published_idx')
      .on(t.slug)
      .where(sql`${t.status} = 'published'`),
    check('parking_locations_status_check', sql`${t.status} in (${sqlList(LISTING_STATUSES)})`),
    check(
      'parking_locations_slug_check',
      sql`${t.slug} ~ '${sql.raw(SLUG_PATTERN.source.replace('(?:', '('))}' and char_length(${t.slug}) <= ${sql.raw(String(LISTING_LIMITS.slug))}`,
    ),
    check(
      'parking_locations_time_zone_check',
      sql`${t.timeZone} in (${sqlList(SUPPORTED_TIME_ZONES)})`,
    ),
    check(
      'parking_locations_text_length_check',
      sql`char_length(${t.name}) between 1 and ${sql.raw(String(LISTING_LIMITS.name))} and char_length(${t.address}) between 1 and ${sql.raw(String(LISTING_LIMITS.address))} and (${t.description} is null or char_length(${t.description}) <= ${sql.raw(String(LISTING_LIMITS.description))})`,
    ),
    check('parking_locations_area_check', sql`${t.areaId} in (${sqlList(AREA_IDS)})`),
    check(
      'parking_locations_content_locale_check',
      sql`${t.contentLocale} in (${sqlList(SUPPORTED_LOCALES)})`,
    ),
    check('parking_locations_currency_check', sql`${t.currency} in (${sqlList(CURRENCIES)})`),
    check('parking_locations_hourly_rate_check', sql`${t.hourlyRateMinor} > 0`),
    check(
      'parking_locations_daily_max_check',
      sql`${t.dailyMaxMinor} is null or ${t.dailyMaxMinor} > 0`,
    ),
  ],
);

export const parkingSpaces = pgTable(
  'parking_spaces',
  {
    id: id(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => parkingLocations.id, { onDelete: 'cascade' }),
    /** Name drivers see on site, e.g. `B-12`. */
    label: text('label').notNull(),
    isCovered: boolean('is_covered').notNull().default(false),
    hasEvCharging: boolean('has_ev_charging').notNull().default(false),
    isAccessible: boolean('is_accessible').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('parking_spaces_location_label_unique').on(t.locationId, t.label),
    check(
      'parking_spaces_label_check',
      sql`char_length(${t.label}) between 1 and ${sql.raw(String(LISTING_LIMITS.spaceLabel))}`,
    ),
    index('parking_spaces_location_active_idx')
      .on(t.locationId)
      .where(sql`${t.isActive}`),
  ],
);

/**
 * Weekly opening periods in the listing's local time: `[opens_minute, closes_minute)` minutes
 * after local midnight on an ISO weekday. Overnight opening is two rows (…–24:00, 00:00–…);
 * 24/7 is seven 0–1440 rows. Periods on the same day never overlap (exclusion constraint in
 * migration 0004).
 */
export const parkingOpeningHours = pgTable(
  'parking_opening_hours',
  {
    id: id(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => parkingLocations.id, { onDelete: 'cascade' }),
    weekday: smallint('weekday').notNull(),
    opensMinute: smallint('opens_minute').notNull(),
    closesMinute: smallint('closes_minute').notNull(),
  },
  (t) => [
    index('parking_opening_hours_location_idx').on(t.locationId),
    check('parking_opening_hours_weekday_check', sql`${t.weekday} between 1 and 7`),
    check(
      'parking_opening_hours_period_check',
      sql`${t.opensMinute} >= 0 and ${t.closesMinute} <= 1440 and ${t.opensMinute} < ${t.closesMinute}`,
    ),
  ],
);
