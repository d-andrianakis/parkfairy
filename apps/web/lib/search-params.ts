// No imports on purpose: client components (the language switcher) use this, and lib/search
// pulls in the zod schemas.

export const WINDOW_PARAM_KEYS = ['startDate', 'startTime', 'endDate', 'endTime'] as const;

/** How long a stay is until someone says otherwise. */
export const DEFAULT_DURATION_MS = 2 * 60 * 60_000;

/** Every query parameter a search or listing page reads. */
export const SEARCH_PARAM_KEYS = [
  'area',
  'place',
  'placeLocale',
  'latitude',
  'longitude',
  ...WINDOW_PARAM_KEYS,
] as const;
