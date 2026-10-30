import { z } from 'zod';
import { contractsRegistry } from './registry.js';

/**
 * Curated search areas. Drivers pick one (or share their location); search sorts listings
 * by distance from its centre. Names live in the web catalogs (`Areas.<id>`), so adding an
 * area means adding both translations.
 */
export const CITIES = ['athens', 'thessaloniki'] as const;
export type City = (typeof CITIES)[number];

export const AREAS = [
  { id: 'syntagma', city: 'athens', latitude: 37.9755, longitude: 23.7348 },
  { id: 'monastiraki', city: 'athens', latitude: 37.9761, longitude: 23.7255 },
  { id: 'kolonaki', city: 'athens', latitude: 37.9786, longitude: 23.7426 },
  { id: 'koukaki', city: 'athens', latitude: 37.9643, longitude: 23.7253 },
  { id: 'piraeusPort', city: 'athens', latitude: 37.942, longitude: 23.6465 },
  { id: 'glyfada', city: 'athens', latitude: 37.865, longitude: 23.753 },
  { id: 'marousi', city: 'athens', latitude: 38.05, longitude: 23.807 },
  { id: 'athensAirport', city: 'athens', latitude: 37.9364, longitude: 23.9445 },
  { id: 'thessalonikiCentre', city: 'thessaloniki', latitude: 40.6326, longitude: 22.941 },
  { id: 'ladadika', city: 'thessaloniki', latitude: 40.6357, longitude: 22.9367 },
  { id: 'thessalonikiAirport', city: 'thessaloniki', latitude: 40.5197, longitude: 22.9709 },
] as const satisfies readonly {
  id: string;
  city: City;
  latitude: number;
  longitude: number;
}[];

export type Area = (typeof AREAS)[number];
export type AreaId = Area['id'];
export const AREA_IDS = AREAS.map((area) => area.id) as [AreaId, ...AreaId[]];

export const AreaIdSchema = z.enum(AREA_IDS).register(contractsRegistry, {
  id: 'AreaId',
  description: 'A curated search area (see AREAS in @parkfairy/contracts).',
});

export function findArea(id: string): Area | undefined {
  return AREAS.find((area) => area.id === id);
}
