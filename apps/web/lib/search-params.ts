// No imports on purpose: client components (the language switcher) use this, and lib/search
// pulls in the zod schemas.

export const WINDOW_PARAM_KEYS = ['startDate', 'startTime', 'endDate', 'endTime'] as const;

/** How long a stay is until someone says otherwise. */
export const DEFAULT_DURATION_MS = 2 * 60 * 60_000;

/** Filters a search can carry (5A.1): space features and security are lists, the sizes centimetres. */
export const FILTER_PARAM_KEYS = [
  'features',
  'security',
  'vehicleHeightCm',
  'vehicleLengthCm',
  'vehicleWidthCm',
] as const;

/** Every query parameter a search or listing page reads. */
export const SEARCH_PARAM_KEYS = [
  'area',
  'place',
  'placeLocale',
  'latitude',
  'longitude',
  ...WINDOW_PARAM_KEYS,
  ...FILTER_PARAM_KEYS,
] as const;
