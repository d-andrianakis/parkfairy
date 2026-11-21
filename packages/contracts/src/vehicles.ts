import { z } from 'zod';

import { ParkingListingSummarySchema, spaceSizeCm } from './parking.js';
import { isVehiclePlate } from './plates.js';
import { contractsRegistry } from './registry.js';
import { message, VEHICLE_LIMITS } from './validation.js';

/**
 * A driver's saved vehicles and favourite listings (Phase 5A.2). Both are the driver's own and
 * private: nothing here reaches an owner, and an owner only ever sees the plate of a booking.
 */

/** Postgres refuses NUL, and a lone surrogate is rewritten: neither gets that far. */
const CONTROL_CHARACTERS = /^[^\p{Cc}\p{Cs}]*$/u;

/** A vehicle as its driver saved it. */
export const SavedVehicleSchema = z
  .object({
    id: z.uuid(),
    /** Normalized (`IKB1234`), like a booking's. */
    plate: z.string(),
    name: z.string().max(VEHICLE_LIMITS.name).nullable(),
    /** The size in centimetres; null is "not said", which is never refused for it. */
    heightCm: z.int().nullable(),
    lengthCm: z.int().nullable(),
    widthCm: z.int().nullable(),
  })
  .register(contractsRegistry, { id: 'SavedVehicle' });
export type SavedVehicle = z.infer<typeof SavedVehicleSchema>;

export const SavedVehicleListSchema = z
  .object({
    vehicles: z.array(SavedVehicleSchema).max(VEHICLE_LIMITS.perDriver),
  })
  .register(contractsRegistry, { id: 'SavedVehicleList' });
export type SavedVehicleList = z.infer<typeof SavedVehicleListSchema>;

/**
 * What a driver sends to save a vehicle, and to change one (the whole thing again). A field left
 * out or empty is cleared.
 */
export const SavedVehicleInputSchema = z
  .object({
    plate: z
      .string(message('plateRequired'))
      .trim()
      // An empty field is "required" only, not also unreadable.
      .min(1, { message: message('plateRequired'), abort: true })
      .refine(isVehiclePlate, message('plateInvalid')),
    name: z
      .string(message('invalid'))
      .trim()
      .max(VEHICLE_LIMITS.name, message('nameTooLong'))
      .regex(CONTROL_CHARACTERS, message('invalid'))
      .nullish(),
    heightCm: spaceSizeCm('height').nullish(),
    lengthCm: spaceSizeCm('length').nullish(),
    widthCm: spaceSizeCm('width').nullish(),
  })
  .strict()
  .register(contractsRegistry, { id: 'SavedVehicleInput' });
export type SavedVehicleInput = z.input<typeof SavedVehicleInputSchema>;

/** Favourite listings kept per driver: a list that is read whole, so it is bounded. */
export const FAVOURITES_MAX = 100;

/** Whether a listing is among the signed-in driver's favourites. */
export const FavouriteStateSchema = z
  .object({ favourite: z.boolean() })
  .register(contractsRegistry, { id: 'FavouriteState' });
export type FavouriteState = z.infer<typeof FavouriteStateSchema>;

/** A driver's favourites that are still live, newest first. */
export const FavouriteListSchema = z
  .object({
    listings: z.array(ParkingListingSummarySchema).max(FAVOURITES_MAX),
  })
  .register(contractsRegistry, { id: 'FavouriteList' });
export type FavouriteList = z.infer<typeof FavouriteListSchema>;

/** Every `code` the vehicle and favourite routes answer with, for clients to translate (a hold refused
 * for size is `VEHICLE_DOES_NOT_FIT`, one of the booking routes'). */
export const VEHICLE_ERROR_CODES = [
  'VEHICLE_NOT_FOUND',
  'VEHICLE_EXISTS',
  'VEHICLE_LIMIT_REACHED',
  'FAVOURITES_LIMIT_REACHED',
] as const;
export type VehicleErrorCode = (typeof VEHICLE_ERROR_CODES)[number];
