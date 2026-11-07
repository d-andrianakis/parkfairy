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
import { and, asc, eq, exists, gte, inArray, lte, not, or, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import {
  hoursOf,
  isOpenThroughout,
  wallTime,
  weekNeeded,
  type DatedHours,
  type OpeningPeriod,
} from './opening-hours.js';
import { NO_PRICE_RULES, quoteStayMinor, type PriceRules } from './pricing.js';

const listing = schema.parkingLocations;
const space = schema.parkingSpaces;
const hours = schema.parkingOpeningHours;
const exception = schema.parkingHoursExceptions;
const rules = schema.parkingPriceRules;
const discounts = schema.parkingStayDiscounts;
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
  spaceCount: number;
  /** Lowest and highest of the spaces' own rates; null when none has one. */
  minOwnRate: number | null;
  maxOwnRate: number | null;
  /** Spaces on the listing's rate. */
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

/** The UTC calendar day of an instant: within a day of the local one, whatever the zone. */
const utcDay = (instant: Date) => instant.toISOString().slice(0, 10);

function money(amountMinor: number, currency: string): Money {
  return { amountMinor, currency: currency as Money['currency'] };
}

/** The cheapest rate among the spaces, and whether any two differ. */
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
  constructor(@Inject(DB) private readonly db: Database) {}

  private hasActiveSpace() {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(space)
        .where(and(eq(space.locationId, listing.id), sql`${space.isActive}`)),
    );
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
            this.hasActiveSpace(),
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
        this.openingHours(ids),
        this.hoursExceptions(ids, firstDay, lastDay),
        this.spaceStats(ids),
        this.priceRules(ids),
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
        const { lowest } = spaceRates(row, spaceStats);
        results.push(
          ParkingSearchResultSchema.parse({
            ...summary(row, spaceStats, covers.get(row.id) ?? null),
            distanceMeters: row.distanceMeters,
            // Every active space is free until bookings exist (Phase 3 subtracts overlapping ones).
            freeSpaces: spaceStats.spaceCount,
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
      })
      .from(listing)
      .where(and(published, eq(listing.slug, slug)))) as (ListingRow & {
      description: string | null;
      location: GeoPoint;
      cancellationPolicy: string | null;
    })[];
    if (!row) return null;

    const today = zonedParts(new Date(), row.timeZone).date;
    const [spaces, periodsById, exceptionsById, priceRulesById, photos] = await Promise.all([
      this.db
        .select({
          label: space.label,
          covered: space.isCovered,
          evCharging: space.hasEvCharging,
          accessible: space.isAccessible,
          ownRate: space.hourlyRateMinor,
        })
        .from(space)
        .where(and(eq(space.locationId, row.id), sql`${space.isActive}`)),
      this.openingHours([row.id]),
      // From yesterday: a window may start in the half hour that began before midnight.
      this.hoursExceptions([row.id], addDays(today, -1)),
      this.priceRules([row.id]),
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
    const periods = periodsById.get(row.id) ?? [];
    const exceptions = exceptionsById.get(row.id) ?? [];
    const priceRules = priceRulesById.get(row.id) ?? NO_PRICE_RULES;
    const ownRates = spaces.flatMap((s) => (s.ownRate === null ? [] : [s.ownRate]));
    const stats: SpaceStats = {
      spaceCount: spaces.length,
      covered: spaces.some((s) => s.covered),
      evCharging: spaces.some((s) => s.evCharging),
      accessible: spaces.some((s) => s.accessible),
      minOwnRate: ownRates.length > 0 ? Math.min(...ownRates) : null,
      maxOwnRate: ownRates.length > 0 ? Math.max(...ownRates) : null,
      atListingRate: spaces.length - ownRates.length,
    };
    const { lowest } = spaceRates(row, stats);

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
      spaces: spaces.slice(0, LISTING_SPACES_LIMIT).map((s) => ({
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
            freeSpaces: spaces.length,
            total: total(row, priceRules, lowest, window),
          }
        : null,
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

  /** Each listing's price rules, for the quote and the listing page. */
  private async priceRules(locationIds: string[]): Promise<Map<string, PriceRules>> {
    const byLocation = new Map<string, PriceRules>();
    if (locationIds.length === 0) return byLocation;
    const entry = (locationId: string) => {
      let found = byLocation.get(locationId);
      if (!found) {
        found = { weekendRateMinor: null, night: null, dated: [], discounts: [] };
        byLocation.set(locationId, found);
      }
      return found;
    };
    const [ruleRows, discountRows] = await Promise.all([
      this.db
        .select()
        .from(rules)
        .where(inArray(rules.locationId, locationIds))
        .orderBy(asc(rules.startsOn)),
      this.db
        .select({
          locationId: discounts.locationId,
          minDays: discounts.minDays,
          percent: discounts.percent,
        })
        .from(discounts)
        .where(inArray(discounts.locationId, locationIds))
        .orderBy(asc(discounts.minDays)),
    ]);
    for (const rule of ruleRows) {
      const target = entry(rule.locationId);
      if (rule.kind === 'weekend') target.weekendRateMinor = rule.hourlyRateMinor;
      else if (rule.kind === 'night' && rule.fromMinute !== null && rule.toMinute !== null) {
        target.night = {
          rateMinor: rule.hourlyRateMinor,
          fromMinute: rule.fromMinute,
          toMinute: rule.toMinute,
        };
      } else if (rule.kind === 'dated' && rule.startsOn && rule.endsOn) {
        target.dated.push({
          startsOn: rule.startsOn,
          endsOn: rule.endsOn,
          rateMinor: rule.hourlyRateMinor,
        });
      }
    }
    for (const { locationId, minDays, percent } of discountRows) {
      entry(locationId).discounts.push({ minDays, percent });
    }
    return byLocation;
  }

  /** Active-space count and features per listing, for the given listings only. */
  private async spaceStats(locationIds: string[]): Promise<Map<string, SpaceStats>> {
    if (locationIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        locationId: space.locationId,
        spaceCount: sql<number>`count(*)::int`,
        covered: sql<boolean>`bool_or(${space.isCovered})`,
        evCharging: sql<boolean>`bool_or(${space.hasEvCharging})`,
        accessible: sql<boolean>`bool_or(${space.isAccessible})`,
        minOwnRate: sql<number | null>`min(${space.hourlyRateMinor})::int`,
        maxOwnRate: sql<number | null>`max(${space.hourlyRateMinor})::int`,
        atListingRate: sql<number>`(count(*) - count(${space.hourlyRateMinor}))::int`,
      })
      .from(space)
      .where(and(inArray(space.locationId, locationIds), sql`${space.isActive}`))
      .groupBy(space.locationId);
    return new Map(rows.map(({ locationId, ...stats }) => [locationId, stats]));
  }

  /** Closures and special hours that touch the days from `from` (to `to`), soonest first. */
  private async hoursExceptions(
    locationIds: string[],
    from: string,
    to?: string,
  ): Promise<Map<string, DatedHours[]>> {
    const byLocation = new Map<string, DatedHours[]>();
    if (locationIds.length === 0) return byLocation;
    const rows = await this.db
      .select({
        locationId: exception.locationId,
        startsOn: exception.startsOn,
        endsOn: exception.endsOn,
        opensMinute: exception.opensMinute,
        closesMinute: exception.closesMinute,
        closedFromMinute: exception.closedFromMinute,
        closedToMinute: exception.closedToMinute,
      })
      .from(exception)
      .where(
        and(
          inArray(exception.locationId, locationIds),
          gte(exception.endsOn, from),
          to === undefined ? undefined : lte(exception.startsOn, to),
        ),
      )
      .orderBy(asc(exception.startsOn));
    for (const { locationId, ...dated } of rows) {
      const list = byLocation.get(locationId);
      if (list) list.push(dated);
      else byLocation.set(locationId, [dated]);
    }
    return byLocation;
  }

  private async openingHours(locationIds: string[]): Promise<Map<string, OpeningPeriod[]>> {
    const byLocation = new Map<string, OpeningPeriod[]>();
    if (locationIds.length === 0) return byLocation;
    const rows = await this.db
      .select({
        locationId: hours.locationId,
        weekday: hours.weekday,
        opensMinute: hours.opensMinute,
        closesMinute: hours.closesMinute,
      })
      .from(hours)
      .where(inArray(hours.locationId, locationIds))
      .orderBy(asc(hours.weekday), asc(hours.opensMinute));
    for (const { locationId, ...period } of rows) {
      const list = byLocation.get(locationId);
      if (list) list.push(period);
      else byLocation.set(locationId, [period]);
    }
    return byLocation;
  }
}
