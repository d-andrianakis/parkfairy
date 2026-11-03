/**
 * Parking inventory: listings (facilities), their individually named spaces, weekly opening
 * hours, price rules, photos and proof of the right to rent. Bookings (Phase 3) will reserve a
 * space for a `[start, end)` interval.
 *
 * An owner builds a listing step by step, so a draft may lack most of its columns;
 * `parking_locations_complete_check` holds every other status to the full set.
 */
import {
  AREA_IDS,
  BOOKING_GAPS,
  CANCELLATION_POLICIES,
  CURRENCIES,
  DEFAULT_TIME_ZONE,
  DISCOUNT_LIMITS,
  LISTING_LIMITS,
  LISTING_STATUSES,
  MAX_BOOKING_DAYS,
  OWNER_LIMITS,
  PHOTO_LIMITS,
  PRICE_LABEL_MAX,
  PROOF_CONTENT_TYPES,
  PROOF_KINDS,
  SLUG_PATTERN,
  SUPPORTED_LOCALES,
  SUPPORTED_TIME_ZONES,
  type AreaId,
  type CancellationPolicy,
  type ListingStatus,
  type Locale,
  type ProofKind,
} from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ownerProfiles } from './owners.js';

export { LISTING_STATUSES, type ListingStatus };

export const PRICE_RULE_KINDS = ['weekend', 'night', 'dated'] as const;
export type PriceRuleKind = (typeof PRICE_RULE_KINDS)[number];

/** `'a', 'b'` list for CHECK constraints built from trusted constants (never user input). */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const limit = (value: number) => sql.raw(String(value));

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
    /** Null only for listings no owner has claimed (the demo data). */
    ownerId: uuid('owner_id').references(() => ownerProfiles.id, { onDelete: 'restrict' }),
    /** URL key, e.g. `syntagma-square-garage`. Drafts hold a placeholder until submitted. */
    slug: text('slug').notNull().unique(),
    name: text('name'),
    description: text('description'),
    address: text('address'),
    areaId: text('area_id').$type<AreaId>(),
    /** Language the owner wrote name, address and description in. */
    contentLocale: text('content_locale').$type<Locale>().notNull().default('el'),
    location: geographyPoint('location'),
    /** IANA zone the opening hours are written in. */
    timeZone: text('time_zone').notNull().default(DEFAULT_TIME_ZONE),
    hourlyRateMinor: integer('hourly_rate_minor'),
    dailyMaxMinor: integer('daily_max_minor'),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    /** Minutes kept free after a booking on the same space (decision #10). */
    bookingGapMinutes: smallint('booking_gap_minutes').notNull().default(0),
    cancellationPolicy: text('cancellation_policy').$type<CancellationPolicy>(),
    /** DAC7 asks for it where one exists (ΚΑΕΚ in Greece). */
    landRegistrationNumber: text('land_registration_number'),
    status: text('status').$type<ListingStatus>().notNull().default('draft'),
    /** What staff asked to have changed; shown to the owner while sent back. */
    reviewNote: text('review_note'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    /** The status the owner last got an email about. Any other status means one is due. */
    notifiedStatus: text('notified_status').$type<ListingStatus>(),
    createdAt: createdAt(),
    /** Last change by the owner, for the reminder; every step's save touches it. */
    updatedAt: updatedAt(),
  },
  (t) => [
    index('parking_locations_location_idx').using('gist', t.location),
    index('parking_locations_owner_idx').on(t.ownerId),
    index('parking_locations_published_idx')
      .on(t.slug)
      .where(sql`${t.status} = 'published'`),
    // For the worker's sweep of statuses nobody has been told about.
    index('parking_locations_status_email_idx')
      .on(t.updatedAt)
      .where(
        sql`${t.ownerId} is not null and ${t.status} in ('in_review', 'changes_requested', 'published') and ${t.notifiedStatus} is distinct from ${t.status}`,
      ),
    check('parking_locations_status_check', sql`${t.status} in (${sqlList(LISTING_STATUSES)})`),
    check(
      'parking_locations_complete_check',
      sql`${t.status} in ('draft', 'changes_requested') or (${t.name} is not null and ${t.address} is not null and ${t.areaId} is not null and ${t.location} is not null and ${t.hourlyRateMinor} is not null)`,
    ),
    check(
      'parking_locations_booking_gap_check',
      sql`${t.bookingGapMinutes} in (${sql.raw(BOOKING_GAPS.join(', '))})`,
    ),
    check(
      'parking_locations_cancellation_policy_check',
      sql`${t.cancellationPolicy} is null or ${t.cancellationPolicy} in (${sqlList(CANCELLATION_POLICIES)})`,
    ),
    check(
      'parking_locations_review_note_check',
      sql`${t.reviewNote} is null or char_length(${t.reviewNote}) <= ${limit(OWNER_LIMITS.reviewNote)}`,
    ),
    check(
      'parking_locations_land_registration_check',
      sql`${t.landRegistrationNumber} is null or char_length(${t.landRegistrationNumber}) <= ${limit(OWNER_LIMITS.landRegistrationNumber)}`,
    ),
    check(
      'parking_locations_slug_check',
      sql`${t.slug} ~ '${sql.raw(SLUG_PATTERN.source.replace('(?:', '('))}' and char_length(${t.slug}) <= ${limit(LISTING_LIMITS.slug)}`,
    ),
    check(
      'parking_locations_time_zone_check',
      sql`${t.timeZone} in (${sqlList(SUPPORTED_TIME_ZONES)})`,
    ),
    check(
      'parking_locations_text_length_check',
      sql`(${t.name} is null or char_length(${t.name}) between 1 and ${limit(LISTING_LIMITS.name)}) and (${t.address} is null or char_length(${t.address}) between 1 and ${limit(LISTING_LIMITS.address)}) and (${t.description} is null or char_length(${t.description}) <= ${limit(LISTING_LIMITS.description)})`,
    ),
    check(
      'parking_locations_area_check',
      sql`${t.areaId} is null or ${t.areaId} in (${sqlList(AREA_IDS)})`,
    ),
    check(
      'parking_locations_content_locale_check',
      sql`${t.contentLocale} in (${sqlList(SUPPORTED_LOCALES)})`,
    ),
    check('parking_locations_currency_check', sql`${t.currency} in (${sqlList(CURRENCIES)})`),
    check(
      'parking_locations_hourly_rate_check',
      sql`${t.hourlyRateMinor} is null or ${t.hourlyRateMinor} > 0`,
    ),
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
    /** This space's own rate; the listing's other prices scale with it. Null uses the listing's. */
    hourlyRateMinor: integer('hourly_rate_minor'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('parking_spaces_location_label_unique').on(t.locationId, t.label),
    check(
      'parking_spaces_label_check',
      sql`char_length(${t.label}) between 1 and ${limit(LISTING_LIMITS.spaceLabel)}`,
    ),
    check(
      'parking_spaces_hourly_rate_check',
      sql`${t.hourlyRateMinor} is null or ${t.hourlyRateMinor} > 0`,
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

/**
 * Prices that replace the hourly rate for part of a stay; for each half hour the most specific
 * wins: dated, then weekend, then night (decision #17). Times and dates are the listing's wall
 * clock. Dated prices never overlap (exclusion constraint in migration 0009).
 */
export const parkingPriceRules = pgTable(
  'parking_price_rules',
  {
    id: id(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => parkingLocations.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<PriceRuleKind>().notNull(),
    hourlyRateMinor: integer('hourly_rate_minor').notNull(),
    /** Night only; `to` before `from` runs across midnight. */
    fromMinute: smallint('from_minute'),
    toMinute: smallint('to_minute'),
    /** Dated only, both days included. */
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    /** Dated only: the owner's own reminder. */
    label: text('label'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('parking_price_rules_location_idx').on(t.locationId),
    uniqueIndex('parking_price_rules_one_weekly_idx')
      .on(t.locationId, t.kind)
      .where(sql`${t.kind} in ('weekend', 'night')`),
    check('parking_price_rules_kind_check', sql`${t.kind} in (${sqlList(PRICE_RULE_KINDS)})`),
    check('parking_price_rules_rate_check', sql`${t.hourlyRateMinor} > 0`),
    check(
      'parking_price_rules_night_check',
      sql`(${t.kind} = 'night') = (${t.fromMinute} is not null and ${t.toMinute} is not null) and (${t.fromMinute} is null or (${t.fromMinute} between 0 and 1439 and ${t.toMinute} between 0 and 1439 and ${t.fromMinute} <> ${t.toMinute}))`,
    ),
    check(
      'parking_price_rules_dated_check',
      sql`(${t.kind} = 'dated') = (${t.startsOn} is not null and ${t.endsOn} is not null) and (${t.startsOn} is null or ${t.startsOn} <= ${t.endsOn})`,
    ),
    check(
      'parking_price_rules_label_check',
      sql`${t.label} is null or char_length(${t.label}) <= ${limit(PRICE_LABEL_MAX)}`,
    ),
  ],
);

/**
 * Percent off a whole stay of at least `min_days`. Never stacks with the daily cap: the driver
 * pays whichever total is lower (decision #17).
 */
export const parkingStayDiscounts = pgTable(
  'parking_stay_discounts',
  {
    id: id(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => parkingLocations.id, { onDelete: 'cascade' }),
    minDays: smallint('min_days').notNull(),
    percent: smallint('percent').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('parking_stay_discounts_location_days_unique').on(t.locationId, t.minDays),
    check(
      'parking_stay_discounts_days_check',
      sql`${t.minDays} between 1 and ${limit(MAX_BOOKING_DAYS)}`,
    ),
    check(
      'parking_stay_discounts_percent_check',
      sql`${t.percent} between ${limit(DISCOUNT_LIMITS.minPercent)} and ${limit(DISCOUNT_LIMITS.maxPercent)}`,
    ),
  ],
);

/** Public photos, lowest `position` first; the first is the cover. */
export const parkingPhotos = pgTable(
  'parking_photos',
  {
    id: id(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => parkingLocations.id, { onDelete: 'cascade' }),
    /** Content hash; files live at `photos/<key>/<width>.webp` in the object store. */
    key: text('key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** In the listing's language. */
    alt: text('alt'),
    color: char('color', { length: 7 }).notNull(),
    position: smallint('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('parking_photos_location_position_idx').on(t.locationId, t.position),
    // Deleting a photo asks whether anything else still shows the file.
    index('parking_photos_key_idx').on(t.key),
    unique('parking_photos_location_key_unique').on(t.locationId, t.key),
    check('parking_photos_key_check', sql`${t.key} ~ '^[0-9a-f]{32}$'`),
    check('parking_photos_size_check', sql`${t.width} > 0 and ${t.height} > 0`),
    check(
      'parking_photos_alt_check',
      sql`${t.alt} is null or char_length(${t.alt}) <= ${limit(PHOTO_LIMITS.alt)}`,
    ),
    check('parking_photos_color_check', sql`${t.color} ~ '^#[0-9a-f]{6}$'`),
    check('parking_photos_position_check', sql`${t.position} >= 0`),
  ],
);

/**
 * Proof of the right to rent. Private: files sit under `proofs/` in the object store and only
 * the owner (and, from Phase 5, staff) can fetch them, through the API. Never listed publicly.
 */
export const parkingProofDocuments = pgTable(
  'parking_proof_documents',
  {
    id: id(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => parkingLocations.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ProofKind>().notNull(),
    storageKey: text('storage_key').notNull().unique(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('parking_proof_documents_location_idx').on(t.locationId),
    check('parking_proof_documents_kind_check', sql`${t.kind} in (${sqlList(PROOF_KINDS)})`),
    check(
      'parking_proof_documents_content_type_check',
      sql`${t.contentType} in (${sqlList(PROOF_CONTENT_TYPES)})`,
    ),
    check('parking_proof_documents_size_check', sql`${t.sizeBytes} > 0`),
  ],
);
