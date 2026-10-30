// No imports on purpose: client components (the language switcher) use this, and lib/search
// pulls in the zod schemas.

export const WINDOW_PARAM_KEYS = ['startDate', 'startTime', 'endDate', 'endTime'] as const;

/** Every query parameter a search or listing page reads. */
export const SEARCH_PARAM_KEYS = ['area', 'latitude', 'longitude', ...WINDOW_PARAM_KEYS] as const;
