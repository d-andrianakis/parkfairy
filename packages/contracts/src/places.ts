import { z } from 'zod';
import { LocaleSchema } from './i18n.js';
import { contractsRegistry } from './registry.js';
import { message, PLACE_QUERY_LIMITS } from './validation.js';

/**
 * Address search for drivers (decision #40). The API asks Mapbox's Search Box on the browser's
 * behalf: suggestions as the driver types, then the chosen one's position. A session (one UUID from
 * the first suggestion to the pick) is what Mapbox bills, once.
 */

/** Suggestions shown at once; Mapbox gives at most 10. */
export const PLACE_SUGGESTIONS_MAX = 5;

/**
 * Mapbox ids are base64 of a URN. They travel back to Mapbox in a URL path, encoded as one segment;
 * still, no part between slashes may be `.` or `..`, in case anything on the way decodes `%2F` and
 * resolves them: that would name another of its endpoints, called with our token.
 */
export const PLACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9+/=_.-]{0,511}$/;

export function isPlaceId(id: string): boolean {
  return PLACE_ID_PATTERN.test(id) && !id.split('/').some((part) => part === '.' || part === '..');
}

const placeQuery = z
  .string()
  .trim()
  .min(PLACE_QUERY_LIMITS.min, message('placeTooShort'))
  .max(PLACE_QUERY_LIMITS.max, message('textTooLong'));

export const PlaceSuggestQuerySchema = z.object({
  q: placeQuery,
  /** One per search session, from the browser; what Mapbox bills by. */
  session: z.uuid(message('invalid')),
  locale: LocaleSchema,
});
export type PlaceSuggestQuery = z.infer<typeof PlaceSuggestQuerySchema>;

export const PlaceRetrieveQuerySchema = z.object({
  id: z.string().refine(isPlaceId, message('invalid')),
  session: z.uuid(message('invalid')),
  locale: LocaleSchema,
});
export type PlaceRetrieveQuery = z.infer<typeof PlaceRetrieveQuerySchema>;

/** Text never picked from the suggestions (or typed without JavaScript), looked up once. */
export const PlaceSearchQuerySchema = z.object({ q: placeQuery, locale: LocaleSchema });
export type PlaceSearchQuery = z.infer<typeof PlaceSearchQuerySchema>;

export const PlaceSuggestionSchema = z
  .object({
    /** Mapbox's id, to ask for its position. */
    id: z.string().refine(isPlaceId),
    name: z.string(),
    /** Where it is: the area, city and postcode. May be empty. */
    detail: z.string(),
  })
  .register(contractsRegistry, { id: 'PlaceSuggestion' });
export type PlaceSuggestion = z.infer<typeof PlaceSuggestionSchema>;

export const PlaceSuggestionsSchema = z
  .object({ suggestions: z.array(PlaceSuggestionSchema).max(PLACE_SUGGESTIONS_MAX) })
  .register(contractsRegistry, { id: 'PlaceSuggestions' });
export type PlaceSuggestions = z.infer<typeof PlaceSuggestionsSchema>;

export const PlaceSchema = z
  .object({
    /** Name and where it is, in one line (`placeLabel`): what the field and the title show. */
    label: z.string().max(PLACE_QUERY_LIMITS.max),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .register(contractsRegistry, { id: 'Place' });
export type Place = z.infer<typeof PlaceSchema>;

export const PlaceListSchema = z
  .object({ places: z.array(PlaceSchema).max(PLACE_SUGGESTIONS_MAX) })
  .register(contractsRegistry, { id: 'PlaceList' });
export type PlaceList = z.infer<typeof PlaceListSchema>;

/**
 * `PLACES_UNAVAILABLE`: no token, Mapbox refused or failed, or the hour's budget is spent.
 * `PLACE_NOT_FOUND`: the suggestion picked has no position any more.
 */
export const PLACE_ERROR_CODES = ['PLACES_UNAVAILABLE', 'PLACE_NOT_FOUND'] as const;
export type PlaceErrorCode = (typeof PLACE_ERROR_CODES)[number];

/** The words a place is shown as: its name, then where it is. */
export function placeLabel({ name, detail }: { name: string; detail: string }): string {
  const label = detail && !name.includes(detail) ? `${name}, ${detail}` : name;
  return label.slice(0, PLACE_QUERY_LIMITS.max);
}
