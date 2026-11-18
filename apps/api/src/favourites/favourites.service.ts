import { Inject, Injectable } from '@nestjs/common';
import {
  type FavouriteList,
  FavouriteListSchema,
  FAVOURITES_MAX,
  type FavouriteState,
} from '@parkfairy/contracts';
import { type Database, schema } from '@parkfairy/database';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { DB } from '../database/database.module.js';
import { listingNotFound } from '../owner/owner.errors.js';
import { ParkingService } from '../parking/parking.service.js';
import { conflictCode, violates } from '../vehicles/vehicles.errors.js';

const favourite = schema.favouriteListings;
const listing = schema.parkingLocations;

/**
 * A driver's favourite listings (5A.2): their own and private. Only a published listing can be
 * favourited, and one that stops being live drops out of the list without being forgotten.
 */
@Injectable()
export class FavouritesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly parking: ParkingService,
  ) {}

  /** Newest first, only the live ones. */
  async list(userId: string): Promise<FavouriteList> {
    const rows = await this.db
      .select({ locationId: favourite.locationId })
      .from(favourite)
      .where(eq(favourite.userId, userId))
      .orderBy(desc(favourite.createdAt), asc(favourite.id))
      .limit(FAVOURITES_MAX);
    const listings = await this.parking.summariesOf(rows.map((row) => row.locationId));
    return FavouriteListSchema.parse({ listings });
  }

  /** Whether a live listing is a favourite; a listing that isn't live is the listing page's 404. */
  async state(userId: string, slug: string): Promise<FavouriteState> {
    const [row] = await this.db
      .select({ favourite: sql<boolean>`${favourite.id} is not null` })
      .from(listing)
      .leftJoin(favourite, and(eq(favourite.locationId, listing.id), eq(favourite.userId, userId)))
      .where(and(eq(listing.slug, slug), sql`${listing.status} = 'published'`));
    if (!row) throw listingNotFound();
    return { favourite: row.favourite };
  }

  /** Keeps it (asked again, it stays); `FAVOURITES_LIMIT_REACHED` past a hundred. */
  async add(userId: string, slug: string): Promise<FavouriteState> {
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ id: listing.id })
        .from(listing)
        .where(and(eq(listing.slug, slug), sql`${listing.status} = 'published'`));
      if (!found) throw listingNotFound();
      // One driver's changes go one at a time, so two at once can't both pass the count.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`favourites:${userId}`}, 0))`,
      );
      const [already] = await tx
        .select({ id: favourite.id })
        .from(favourite)
        .where(and(eq(favourite.userId, userId), eq(favourite.locationId, found.id)));
      if (already) return { favourite: true };
      const [{ count = 0 } = {}] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(favourite)
        .where(eq(favourite.userId, userId));
      if (count >= FAVOURITES_MAX) throw conflictCode('FAVOURITES_LIMIT_REACHED');
      try {
        await tx.insert(favourite).values({ userId, locationId: found.id });
      } catch (error) {
        // The listing was deleted between the lookup and the insert.
        if (violates(error, '23503', 'favourite_listings_location_id_parking_locations_id_fk')) {
          throw listingNotFound();
        }
        throw error;
      }
      return { favourite: true };
    });
  }

  /** Forgets it, whether or not it was kept, and whether or not the listing is live. */
  async remove(userId: string, slug: string): Promise<FavouriteState> {
    await this.db
      .delete(favourite)
      .where(
        and(
          eq(favourite.userId, userId),
          eq(
            favourite.locationId,
            sql`(select ${listing.id} from ${listing} where ${listing.slug} = ${slug})`,
          ),
        ),
      );
    return { favourite: false };
  }
}
