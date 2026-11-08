import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  findArea,
  LISTING_SPACES_LIMIT,
  ParkingListingDetailSchema,
  ParkingListingSummarySchema,
  ParkingSearchResultSchema,
  PARKING_FEATURES,
  SEARCH_RADIUS_METERS,
  SUPPORTED_TIME_ZONES,
  zonedParts,
  type AreaId,
  type ListingPhoto,
  type ListingPriceRules,
  type Money,
  type ParkingFeature,
  type ParkingListingDetail,
  type ParkingListingSummary,
  type ParkingSearchQuery,
  type ParkingSearchResult,
} from '@parkfairy/contracts';
import { schema, type Database, type GeoPoint } from '@parkfairy/database';
import { and, asc, eq, exists, inArray, not, or, sql } from 'drizzle-orm';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB } from '../database/database.module.js';
import { takenSpaceIds } from './availability.js';
import { hoursExceptionsOf, openingHoursOf, priceRulesOf, utcDay } from './listing-data.js';
import { hoursOf, isOpenThroughout, wallTime, weekNeeded } from './opening-hours.js';
import { NO_PRICE_RULES, quoteStayMinor, type PriceRules } from './pricing.js';

const listing = schema.parkingLocations;
const space = schema.parkingSpaces;
const hours = schema.parkingOpeningHours;
const exception = schema.parkingHoursExceptions;
const photo = schema.parkingPhotos;

const FEATURED_LIMIT = 6;
const SEARCH_LIMIT = 50;
/** Search reads nearest-first candidates in batches until SEARCH_LIMIT are open (or none left). */
export const SEARCH_BATCH = 100;
export const SEARCH_MAX_BATCHES = 5;

const labels = new Intl.Collator('en', { numeric: true });

export interface Window {
  start: Date;
  end: Date;
}

const listingColumns = {
  id: listing.id,
  slug: listing.slug,
  name: listing.name,
  address: listing.address,
  area: listing.areaId,
  contentLocale: listing.contentLocale,
  timeZone: listing.timeZone,
  hourlyRateMinor: listing.hourlyRateMinor,
  dailyMaxMinor: listing.dailyMaxMinor,
  currency: listing.currency,
};

type FeatureFlags = Record<ParkingFeature, boolean>;

interface SpaceStats extends FeatureFlags {
  /** Active spaces, free or not. */
  spaceCount: number;
  /** Of those, the ones free for the window asked about (all of them without one). */
  freeCount: number;
  /** Lowest and highest of the free spaces' own rates; null when none has one. */
  minOwnRate: number | null;
  maxOwnRate: number | null;
  /** Free spaces on the listing's rate. */
  atListingRate: number;
}

/**
 * Only published rows are read here, and `parking_locations_complete_check` holds those to the
 * full set of columns, however empty a draft may be.
 */
interface ListingRow {
  id: string;
  slug: string;
  name: string;
  address: string;
  area: AreaId;
  contentLocale: string;
  timeZone: string;
  hourlyRateMinor: number;
  dailyMaxMinor: number | null;
  currency: string;
}

const NO_SPACES: SpaceStats = {
  spaceCount: 0,
  freeCount: 0,
  covered: false,
  evCharging: false,
  accessible: false,
  minOwnRate: null,
  maxOwnRate: null,
  atListingRate: 0,
};

function features(flags: FeatureFlags): ParkingFeature[] {
  return PARKING_FEATURES.filter((feature) => flags[feature]);
}

function money(amountMinor: number, currency: string): Money {
  return { amountMinor, currency: currency as Money['currency'] };
}

/** The cheapest rate among the (free) spaces, and whether any two differ. */
function spaceRates(row: ListingRow, stats: SpaceStats) {
  const own = [stats.minOwnRate, stats.maxOwnRate].filter((rate) => rate !== null);
  const all = stats.atListingRate > 0 ? [...own, row.hourlyRateMinor] : own;
  const lowest = all.length > 0 ? Math.min(...all) : row.hourlyRateMinor;
  return { lowest, vary: all.length > 0 && Math.max(...all) !== lowest };
}

function summary(
  row: ListingRow,
  stats: SpaceStats,
  coverPhoto: ListingPhoto | null,
): ParkingListingSummary {
  const { lowest, vary } = spaceRates(row, stats);
  return ParkingListingSummarySchema.parse({
    ...row,
    spaceCount: stats.spaceCount,
    hourlyRate: money(lowest, row.currency),
    spacePricesVary: vary,
    dailyMax: row.dailyMaxMinor === null ? null : money(row.dailyMaxMinor, row.currency),
    features: features(stats),
    coverPhoto,
  });
}

/** Rate statistics of some spaces, as `spaceRates` reads them. */
function rateStats(
  spaces: { ownRate: number | null }[],
): Pick<SpaceStats, 'minOwnRate' | 'maxOwnRate' | 'atListingRate'> {
  const own = spaces.flatMap((s) => (s.ownRate === null ? [] : [s.ownRate]));
  return {
    minOwnRate: own.length > 0 ? Math.min(...own) : null,
    maxOwnRate: own.length > 0 ? Math.max(...own) : null,
    atListingRate: spaces.length - own.length,
  };
}

function total(
  row: ListingRow,
  priceRules: PriceRules,
  spaceRateMinor: number,
  { start, end }: Window,
) {
  const amount = quoteStayMinor({
    rates: row,
    rules: priceRules,
    spaceRateMinor,
    start,
    end,
    timeZone: row.timeZone,
  });
  return money(amount, row.currency);
}

// Literal SQL so the partial indexes match whatever the statement mode.
const published = sql`${listing.status} = 'published'`;

@Injectable()
export class ParkingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Pick<Env, 'bookingWithoutPayment'>,
  ) {}

  private hasActiveSpace() {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(space)
        .where(and(eq(space.locationId, listing.id), sql`${space.isActive}`)),
    );
  }

  /**
   * Whether some active space has no booking or running hold in the window (gap included): more
   * active spaces than active spaces taken, in one probe of the listing's bookings. Probing each
   * space instead made a full garage, the very thing at peak hours, cost hundreds of them.
   */
  private hasFreeSpace(window: Window) {
    return sql`(select count(*) from ${space} s where s.location_id = ${listing.id} and s.is_active)
      > (select count(distinct t.space_id) from (${takenSpaceIds(listing.id, window, listing.bookingGapMinutes)}) t
        join ${space} taken on taken.id = t.space_id and taken.is_active)`;
  }

  /**
   * Whether the listing is closed all day on any local day that `[start, end)` touches. Such a
   * listing can't be open for the stay, so search drops it before it takes one of a batch's
   * places: holidays close many listings at once (and copying spreads them across a chain), and
   * the batches would otherwise fill with them. Other hours and closed parts stay with
   * `isOpenThroughout`. The end is exclusive, so a stay ending at midnight touches no next day.
   */
  private closedAllDayDuring(window: Window) {
    return this.exceptionDuring(
      window,
      sql`and e.opens_minute is null and e.closed_from_minute is null`,
    );
  }

  /** Whether any closure or special hours (`kind` narrows it) fall on a local day of the stay. */
  private exceptionDuring({ start, end }: Window, kind = sql``) {
    const from = start.toISOString();
    const until = end.toISOString();
    return sql`exists (select 1 from ${exception} e where e.location_id = ${listing.id} ${kind}
      and e.ends_on >= (${from}::timestamptz at time zone ${listing.timeZone})::date
      and e.starts_on <= ((${until}::timestamptz - interval '1 microsecond') at time zone ${listing.timeZone})::date)`;
  }

  /**
   * Whether the listing's weekly hours cover `[start, end)` on its wall clock: the minute-of-week
   * multirange of its periods (touching ones merge, so a night across midnight is one range) must
   * contain the minutes `weekNeeded` works out, once per time zone rather than per row. The same
   * reading as `isOpenThroughout`, done before a candidate takes a batch's place: an area where
   * most are shut at that hour would otherwise use up the batches. Days with closures or special
   * hours replace the week's hours, so those listings are left to `isOpenThroughout`.
   */
  private weekCovers({ start, end }: Window) {
    const needed = SUPPORTED_TIME_ZONES.map(
      (zone) => sql`when ${zone} then ${weekNeeded(start, end, zone)}::int4multirange`,
    );
    return sql`coalesce((select range_agg(int4range((h.weekday - 1) * 1440 + h.opens_minute,
        (h.weekday - 1) * 1440 + h.closes_minute)) from ${hours} h where h.location_id = ${listing.id}),
        '{}'::int4multirange) @> (case ${listing.timeZone} ${sql.join(needed, sql` `)}
        else '{}'::int4multirange end)`;
  }

  /** Published listings that have at least one space, for the home page. */
  async featured(): Promise<ParkingListingSummary[]> {
    // Pick the rows first, then add up spaces for just those (not every listing's spaces).
    const rows = (await this.db
      .select(listingColumns)
      .from(listing)
      .where(and(published, this.hasActiveSpace()))
      .orderBy(asc(listing.slug))
      .limit(FEATURED_LIMIT)) as ListingRow[];
    const ids = rows.map((row) => row.id);
    const [stats, covers] = await Promise.all([this.spaceStats(ids), this.coverPhotos(ids)]);
    return rows.map((row) =>
      summary(row, stats.get(row.id) ?? NO_SPACES, covers.get(row.id) ?? null),
    );
  }

  /**
   * Published listings within SEARCH_RADIUS_METERS of the area or position, nearest first,
   * that are open for the whole window and have a free space. Opening hours are checked per
   * batch of nearest candidates, so open listings beyond closed ones are still found.
   */
  async search(query: ParkingSearchQuery): Promise<ParkingSearchResult[]> {
    const area = query.area ? findArea(query.area) : undefined;
    const latitude = area?.latitude ?? query.latitude ?? 0;
    const longitude = area?.longitude ?? query.longitude ?? 0;
    const point = sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`;
    const window = { start: new Date(query.start), end: new Date(query.end) };
    // A day either side, so the window's local days are covered in any zone.
    const firstDay = addDays(utcDay(window.start), -1);
    const lastDay = addDays(utcDay(window.end), 1);

    const results: ParkingSearchResult[] = [];
    for (let batch = 0; batch < SEARCH_MAX_BATCHES && results.length < SEARCH_LIMIT; batch++) {
      const rows = (await this.db
        .select({
          ...listingColumns,
          distanceMeters: sql<number>`round(ST_Distance(${listing.location}, ${point}))::int`,
        })
        .from(listing)
        .where(
          and(
            published,
            sql`ST_DWithin(${listing.location}, ${point}, ${SEARCH_RADIUS_METERS})`,
            this.hasFreeSpace(window),
            not(this.closedAllDayDuring(window)),
            or(this.exceptionDuring(window), this.weekCovers(window)),
          ),
        )
        // Nearest first; slug breaks ties so batches never overlap. The planner narrows by the
        // GiST bounding box and sorts the candidates (fine at today's density, memory.md).
        .orderBy(sql`${listing.location} <-> ${point}`, asc(listing.slug))
        .limit(SEARCH_BATCH)
        .offset(batch * SEARCH_BATCH)) as (ListingRow & { distanceMeters: number })[];
      if (rows.length === 0) break;

      const ids = rows.map((row) => row.id);
      const [periods, exceptions, stats, priceRules, covers] = await Promise.all([
        openingHoursOf(this.db, ids),
        hoursExceptionsOf(this.db, ids, firstDay, lastDay),
        this.spaceStats(ids, window),
        priceRulesOf(this.db, ids, { parallel: true }),
        this.coverPhotos(ids),
      ]);
      for (const row of rows) {
        if (results.length === SEARCH_LIMIT) break;
        const open = isOpenThroughout(
          periods.get(row.id) ?? [],
          window.start,
          window.end,
          row.timeZone,
          exceptions.get(row.id),
        );
        if (!open) continue;
        const spaceStats = stats.get(row.id) ?? NO_SPACES;
        // A booking made between the two reads; the next search won't show it.
        if (spaceStats.freeCount === 0) continue;
        const { lowest } = spaceRates(row, spaceStats);
        results.push(
          ParkingSearchResultSchema.parse({
            ...summary(row, spaceStats, covers.get(row.id) ?? null),
            distanceMeters: row.distanceMeters,
            freeSpaces: spaceStats.freeCount,
            total: total(row, priceRules.get(row.id) ?? NO_PRICE_RULES, lowest, window),
          }),
        );
      }
      if (rows.length < SEARCH_BATCH) break;
    }
    return results;
  }

  /** A published listing with its spaces and hours; null when unknown or not public. */
  async findBySlug(slug: string, window?: Window): Promise<ParkingListingDetail | null> {
    const [row] = (await this.db
      .select({
        ...listingColumns,
        description: listing.description,
        location: listing.location,
        cancellationPolicy: listing.cancellationPolicy,
        bookingGapMinutes: listing.bookingGapMinutes,
      })
      .from(listing)
      .where(and(published, eq(listing.slug, slug)))) as (ListingRow & {
      description: string | null;
      location: GeoPoint;
      cancellationPolicy: string | null;
      bookingGapMinutes: number;
    })[];
    if (!row) return null;

    const today = zonedParts(new Date(), row.timeZone).date;
    const [spaces, taken, periodsById, exceptionsById, priceRulesById, photos] = await Promise.all([
      this.db
        .select({
          id: space.id,
          label: space.label,
          covered: space.isCovered,
          evCharging: space.hasEvCharging,
          accessible: space.isAccessible,
          ownRate: space.hourlyRateMinor,
        })
        .from(space)
        .where(and(eq(space.locationId, row.id), sql`${space.isActive}`)),
      window
        ? this.db.execute<{ space_id: string }>(
            takenSpaceIds(sql`${row.id}`, window, sql`${row.bookingGapMinutes}`),
          )
        : Promise.resolve({ rows: [] }),
      openingHoursOf(this.db, [row.id]),
      // From yesterday: a window may start in the half hour that began before midnight.
      hoursExceptionsOf(this.db, [row.id], addDays(today, -1)),
      priceRulesOf(this.db, [row.id], { parallel: true }),
      this.db
        .select({
          key: photo.key,
          width: photo.width,
          height: photo.height,
          alt: photo.alt,
          color: photo.color,
        })
        .from(photo)
        .where(eq(photo.locationId, row.id))
        .orderBy(asc(photo.position), asc(photo.createdAt)),
    ]);
    spaces.sort((a, b) => labels.compare(a.label, b.label));
    const takenIds = new Set(taken.rows.map((t) => t.space_id));
    const freeSpaces = spaces.filter((s) => !takenIds.has(s.id));
    const periods = periodsById.get(row.id) ?? [];
    const exceptions = exceptionsById.get(row.id) ?? [];
    const priceRules = priceRulesById.get(row.id) ?? NO_PRICE_RULES;
    const stats: SpaceStats = {
      spaceCount: spaces.length,
      freeCount: freeSpaces.length,
      covered: spaces.some((s) => s.covered),
      evCharging: spaces.some((s) => s.evCharging),
      accessible: spaces.some((s) => s.accessible),
      ...rateStats(spaces),
    };
    // The total quoted is the cheapest free space's; with none free, the cheapest space's.
    const { lowest } = spaceRates(
      row,
      freeSpaces.length > 0 ? { ...stats, ...rateStats(freeSpaces) } : stats,
    );

    return ParkingListingDetailSchema.parse({
      ...summary(row, stats, photos[0] ?? null),
      description: row.description,
      latitude: row.location.latitude,
      longitude: row.location.longitude,
      timeZone: row.timeZone,
      photos,
      priceRules: this.publicRules(priceRules, row),
      cancellationPolicy: row.cancellationPolicy,
      openingHours: periods.map((period) => ({
        weekday: period.weekday,
        opens: wallTime(period.opensMinute),
        closes: wallTime(period.closesMinute),
      })),
      // Dates and hours only: the owner's note is never public (decision #26).
      hoursExceptions: exceptions
        .filter(({ endsOn }) => endsOn >= today)
        .map((dated) => ({
          startsOn: dated.startsOn,
          endsOn: dated.endsOn,
          ...hoursOf(dated),
        })),
      // With a window, the free ones: a garage whose first 48 are booked still offers the rest.
      spaces: (window ? freeSpaces : spaces).slice(0, LISTING_SPACES_LIMIT).map((s) => ({
        id: s.id,
        label: s.label,
        features: features(s),
        hourlyRate: money(s.ownRate ?? row.hourlyRateMinor, row.currency),
        total: window ? total(row, priceRules, s.ownRate ?? row.hourlyRateMinor, window) : null,
      })),
      availability: window
        ? {
            start: window.start.toISOString(),
            end: window.end.toISOString(),
            open: isOpenThroughout(periods, window.start, window.end, row.timeZone, exceptions),
            freeSpaces: freeSpaces.length,
            total: total(row, priceRules, lowest, window),
          }
        : null,
      bookingOpen: this.env.bookingWithoutPayment,
    });
  }

  /** What a driver reads on the listing page. Prices that have ended are left out. */
  private publicRules(priceRules: PriceRules, row: ListingRow): ListingPriceRules {
    const today = zonedParts(new Date(), row.timeZone).date;
    return {
      weekendRate:
        priceRules.weekendRateMinor === null
          ? null
          : money(priceRules.weekendRateMinor, row.currency),
      night: priceRules.night && {
        rate: money(priceRules.night.rateMinor, row.currency),
        from: wallTime(priceRules.night.fromMinute),
        to: wallTime(priceRules.night.toMinute),
      },
      dated: priceRules.dated
        .filter(({ endsOn }) => endsOn >= today)
        .map(({ startsOn, endsOn, rateMinor }) => ({
          startsOn,
          endsOn,
          rate: money(rateMinor, row.currency),
        })),
      longStay: priceRules.discounts,
    };
  }

  /** The first photo of each listing. */
  private async coverPhotos(locationIds: string[]): Promise<Map<string, ListingPhoto>> {
    if (locationIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([photo.locationId], {
        locationId: photo.locationId,
        key: photo.key,
        width: photo.width,
        height: photo.height,
        alt: photo.alt,
        color: photo.color,
      })
      .from(photo)
      .where(inArray(photo.locationId, locationIds))
      .orderBy(photo.locationId, asc(photo.position), asc(photo.createdAt));
    return new Map(rows.map(({ locationId, ...cover }) => [locationId, cover]));
  }

  /**
   * Active-space count and features per listing, and with a window which of them are free: the
   * rates come from the free ones, since search quotes "from" the cheapest free space (#17). The
   * taken spaces come from one probe per listing, joined once, never a lookup per space per
   * aggregate.
   */
  private async spaceStats(
    locationIds: string[],
    window?: Window,
  ): Promise<Map<string, SpaceStats>> {
    if (locationIds.length === 0) return new Map();
    const taken = window
      ? sql`select distinct t.space_id from ${listing} l
          cross join lateral (${takenSpaceIds(sql`l.id`, window, sql`l.booking_gap_minutes`)}) t
          where l.id in ${locationIds}`
      : sql`select null::uuid as space_id where false`;
    const { rows } = await this.db.execute<
      SpaceStats & { locationId: string } & Record<string, unknown>
    >(sql`
      select s.location_id as "locationId",
        count(*)::int as "spaceCount",
        (count(*) filter (where t.space_id is null))::int as "freeCount",
        bool_or(s.is_covered) as "covered",
        bool_or(s.has_ev_charging) as "evCharging",
        bool_or(s.is_accessible) as "accessible",
        (min(s.hourly_rate_minor) filter (where t.space_id is null))::int as "minOwnRate",
        (max(s.hourly_rate_minor) filter (where t.space_id is null))::int as "maxOwnRate",
        (count(*) filter (where t.space_id is null and s.hourly_rate_minor is null))::int
          as "atListingRate"
      from ${space} s
      left join (${taken}) t on t.space_id = s.id
      where s.location_id in ${locationIds} and s.is_active
      group by s.location_id`);
    return new Map(rows.map(({ locationId, ...stats }) => [locationId, stats]));
  }
}
