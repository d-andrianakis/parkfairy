import { Inject, Injectable } from '@nestjs/common';
import {
  normalizeVehiclePlate,
  type SavedVehicle,
  SavedVehicleInputSchema,
  type SavedVehicleList,
  SavedVehicleListSchema,
  VEHICLE_LIMITS,
} from '@parkfairy/contracts';
import { type Database, schema } from '@parkfairy/database';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { DB } from '../database/database.module.js';
import { conflictCode, UUID, vehicleNotFound, violates } from './vehicles.errors.js';

const vehicle = schema.savedVehicles;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Row = typeof vehicle.$inferSelect;

const viewOf = (row: Row): SavedVehicle => ({
  id: row.id,
  plate: row.plate,
  name: row.name,
  heightCm: row.heightCm,
  lengthCm: row.lengthCm,
  widthCm: row.widthCm,
});

/** The columns an input sets: the plate normalized, the rest as sent, nothing left out. */
function valuesOf(input: z.output<typeof SavedVehicleInputSchema>) {
  return {
    plate: normalizeVehiclePlate(input.plate),
    // Left empty, a nickname is none.
    name: input.name || null,
    heightCm: input.heightCm ?? null,
    lengthCm: input.lengthCm ?? null,
    widthCm: input.widthCm ?? null,
  };
}

/**
 * A driver's saved vehicles (5A.2): their own, private, at most VEHICLE_LIMITS.perDriver. Every call
 * reaches the session user's rows only, and another driver's vehicle is the same 404 as a missing one.
 */
@Injectable()
export class VehiclesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(userId: string): Promise<SavedVehicleList> {
    return this.listIn(this.db, userId);
  }

  private async listIn(reader: Database | Transaction, userId: string): Promise<SavedVehicleList> {
    const rows = await reader
      .select()
      .from(vehicle)
      .where(eq(vehicle.userId, userId))
      .orderBy(asc(vehicle.createdAt), asc(vehicle.id))
      .limit(VEHICLE_LIMITS.perDriver);
    return SavedVehicleListSchema.parse({ vehicles: rows.map(viewOf) });
  }

  /** Saves one, unless it is saved already (`VEHICLE_EXISTS`) or the driver has the most (`VEHICLE_LIMIT_REACHED`). */
  async create(userId: string, input: z.output<typeof SavedVehicleInputSchema>) {
    try {
      return await this.db.transaction(async (tx) => {
        // Two saves at once must not both pass the count: one driver's saves go one at a time.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`vehicles:${userId}`}, 0))`,
        );
        const [{ count = 0 } = {}] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(vehicle)
          .where(eq(vehicle.userId, userId));
        if (count >= VEHICLE_LIMITS.perDriver) throw conflictCode('VEHICLE_LIMIT_REACHED');
        await tx.insert(vehicle).values({ userId, ...valuesOf(input) });
        return this.listIn(tx, userId);
      });
    } catch (error) {
      if (violates(error, '23505', 'saved_vehicles_user_plate_unique')) {
        throw conflictCode('VEHICLE_EXISTS');
      }
      throw error;
    }
  }

  /** Replaces what is saved of one vehicle. */
  async update(userId: string, id: string, input: z.output<typeof SavedVehicleInputSchema>) {
    if (!UUID.test(id)) throw vehicleNotFound();
    try {
      return await this.db.transaction(async (tx) => {
        const changed = await tx
          .update(vehicle)
          .set(valuesOf(input))
          .where(and(eq(vehicle.id, id), eq(vehicle.userId, userId)))
          .returning({ id: vehicle.id });
        if (changed.length === 0) throw vehicleNotFound();
        return this.listIn(tx, userId);
      });
    } catch (error) {
      if (violates(error, '23505', 'saved_vehicles_user_plate_unique')) {
        throw conflictCode('VEHICLE_EXISTS');
      }
      throw error;
    }
  }

  /** Forgets one. Bookings made for it keep their plate; they only lose the link. */
  async remove(userId: string, id: string): Promise<SavedVehicleList> {
    if (!UUID.test(id)) throw vehicleNotFound();
    return this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(vehicle)
        .where(and(eq(vehicle.id, id), eq(vehicle.userId, userId)))
        .returning({ id: vehicle.id });
      if (removed.length === 0) throw vehicleNotFound();
      return this.listIn(tx, userId);
    });
  }
}
