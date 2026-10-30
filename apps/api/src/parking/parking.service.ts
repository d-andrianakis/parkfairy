import { Inject, Injectable } from '@nestjs/common';
import {
  findArea,
  LISTING_SPACES_LIMIT,
  ParkingListingDetailSchema,
  ParkingListingSummarySchema,
  ParkingSearchResultSchema,
  PARKING_FEATURES,
  SEARCH_RADIUS_METERS,
  type ParkingFeature,
  type ParkingListingDetail,
  type ParkingListingSummary,
  type ParkingSearchQuery,
  type ParkingSearchResult,
} from '@parkfairy/contracts';
import { schema, type Database } from '@parkfairy/database';
import { and, asc, eq, exists, inArray, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import { isOpenThroughout, wallTime, type OpeningPeriod } from './opening-hours.js';
import { quoteTotalMinor, type Rates } from './pricing.js';

const listing = schema.parkingLocations;
const space = schema.parkingSpaces;
const hours = schema.parkingOpeningHours;

const FEATURED_LIMIT = 6;
const SEARCH_LIMIT = 50;
/** Search reads nearest-first candidates in batches until SEARCH_LIMIT are open (or none left). */
const SEARCH_BATCH = 100;
const SEARCH_MAX_BATCHES = 5;

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
}

interface ListingRow {
  id: string;
  slug: string;
  name: string;
  address: string;
  area: string;
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
};

function features(flags: FeatureFlags): ParkingFeature[] {
  return PARKING_FEATURES.filter((feature) => flags[feature]);
}

function money(amountMinor: number, currency: string) {
  return { amountMinor, currency };
}

function summary(row: ListingRow, stats: SpaceStats): ParkingListingSummary {
  return ParkingListingSummarySchema.parse({
    ...row,
    spaceCount: stats.spaceCount,
    hourlyRate: money(row.hourlyRateMinor, row.currency),
    dailyMax: row.dailyMaxMinor === null ? null : money(row.dailyMaxMinor, row.currency),
    features: features(stats),
  });
}

function total(rates: Rates & { currency: string }, { start, end }: Window) {
  return money(quoteTotalMinor(rates, (end.getTime() - start.getTime()) / 60_000), rates.currency);
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

  /** Published listings that have at least one space, for the home page. */
  async featured(): Promise<ParkingListingSummary[]> {
    // Pick the rows first, then add up spaces for just those (not every listing's spaces).
    const rows = await this.db
      .select(listingColumns)
      .from(listing)
      .where(and(published, this.hasActiveSpace()))
      .orderBy(asc(listing.slug))
      .limit(FEATURED_LIMIT);
    const stats = await this.spaceStats(rows.map((row) => row.id));
    return rows.map((row) => summary(row, stats.get(row.id) ?? NO_SPACES));
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

    const results: ParkingSearchResult[] = [];
    for (let batch = 0; batch < SEARCH_MAX_BATCHES && results.length < SEARCH_LIMIT; batch++) {
      const rows = await this.db
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
          ),
        )
        // Nearest first; slug breaks ties so batches never overlap. The planner narrows by the
        // GiST bounding box and sorts the candidates (fine at today's density, memory.md).
        .orderBy(sql`${listing.location} <-> ${point}`, asc(listing.slug))
        .limit(SEARCH_BATCH)
        .offset(batch * SEARCH_BATCH);
      if (rows.length === 0) break;

      const ids = rows.map((row) => row.id);
      const [periods, stats] = await Promise.all([this.openingHours(ids), this.spaceStats(ids)]);
      for (const row of rows) {
        if (results.length === SEARCH_LIMIT) break;
        if (!isOpenThroughout(periods.get(row.id) ?? [], window.start, window.end, row.timeZone)) {
          continue;
        }
        const spaceStats = stats.get(row.id) ?? NO_SPACES;
        results.push(
          ParkingSearchResultSchema.parse({
            ...summary(row, spaceStats),
            distanceMeters: row.distanceMeters,
            // Every active space is free until bookings exist (Phase 3 subtracts overlapping ones).
            freeSpaces: spaceStats.spaceCount,
            total: total(row, window),
          }),
        );
      }
      if (rows.length < SEARCH_BATCH) break;
    }
    return results;
  }

  /** A published listing with its spaces and hours; null when unknown or not public. */
  async findBySlug(slug: string, window?: Window): Promise<ParkingListingDetail | null> {
    const [row] = await this.db
      .select({ ...listingColumns, description: listing.description, location: listing.location })
      .from(listing)
      .where(and(published, eq(listing.slug, slug)));
    if (!row) return null;

    const [spaces, periodsById] = await Promise.all([
      this.db
        .select({
          label: space.label,
          covered: space.isCovered,
          evCharging: space.hasEvCharging,
          accessible: space.isAccessible,
        })
        .from(space)
        .where(and(eq(space.locationId, row.id), sql`${space.isActive}`)),
      this.openingHours([row.id]),
    ]);
    spaces.sort((a, b) => labels.compare(a.label, b.label));
    const periods = periodsById.get(row.id) ?? [];
    const stats: SpaceStats = {
      spaceCount: spaces.length,
      covered: spaces.some((s) => s.covered),
      evCharging: spaces.some((s) => s.evCharging),
      accessible: spaces.some((s) => s.accessible),
    };

    return ParkingListingDetailSchema.parse({
      ...summary(row, stats),
      description: row.description,
      latitude: row.location.latitude,
      longitude: row.location.longitude,
      timeZone: row.timeZone,
      openingHours: periods.map((period) => ({
        weekday: period.weekday,
        opens: wallTime(period.opensMinute),
        closes: wallTime(period.closesMinute),
      })),
      spaces: spaces
        .slice(0, LISTING_SPACES_LIMIT)
        .map((s) => ({ label: s.label, features: features(s) })),
      availability: window
        ? {
            start: window.start.toISOString(),
            end: window.end.toISOString(),
            open: isOpenThroughout(periods, window.start, window.end, row.timeZone),
            freeSpaces: spaces.length,
            total: total(row, window),
          }
        : null,
    });
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
      })
      .from(space)
      .where(and(inArray(space.locationId, locationIds), sql`${space.isActive}`))
      .groupBy(space.locationId);
    return new Map(rows.map(({ locationId, ...stats }) => [locationId, stats]));
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
