import {
  BOOKING_STEP_MINUTES,
  currentSlotStart,
  DEFAULT_TIME_ZONE,
  isValidationMessage,
  ParkingListingQuerySchema,
  ParkingSearchQuerySchema,
  zonedParts,
  zonedTimeToUtc,
  type ParkingSearchQuery,
  type ValidationMessage,
} from '@parkfairy/contracts';
import { DEFAULT_DURATION_MS, WINDOW_PARAM_KEYS } from './search-params';

/**
 * Search forms submit Athens wall-clock dates and half-hour times (GET, so results are
 * shareable and work without JavaScript). This module turns them into a validated API query.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

const STEP_MS = BOOKING_STEP_MINUTES * 60_000;

/** `00:00`, `00:30`, … `23:30`. */
export const TIME_OPTIONS = Array.from({ length: (24 * 60) / BOOKING_STEP_MINUTES }, (_, i) => {
  const minutes = i * BOOKING_STEP_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

export interface WindowValues {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

export interface SearchValues extends WindowValues {
  area: string;
  latitude: string;
  longitude: string;
}

export type SearchField = 'area' | 'start' | 'end';
export type SearchErrors = Partial<Record<SearchField, ValidationMessage>>;

const WINDOW_KEYS = WINDOW_PARAM_KEYS;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** Today in Athens, for the date inputs' `min`. */
export function today(now = Date.now()): string {
  return zonedParts(new Date(now), DEFAULT_TIME_ZONE).date;
}

/** The next half hour, for two hours. */
export function defaultWindow(now = Date.now()): WindowValues {
  const start = new Date(currentSlotStart(now) + STEP_MS);
  const end = new Date(start.getTime() + DEFAULT_DURATION_MS);
  const from = zonedParts(start, DEFAULT_TIME_ZONE);
  const until = zonedParts(end, DEFAULT_TIME_ZONE);
  return { startDate: from.date, startTime: from.time, endDate: until.date, endTime: until.time };
}

function fieldOf(path: PropertyKey[]): SearchField {
  const [key] = path;
  return key === 'start' || key === 'end' ? key : 'area';
}

function collect(
  issues: { path: PropertyKey[]; message: string }[],
  errors: SearchErrors,
): SearchErrors {
  const result = { ...errors };
  for (const issue of issues) {
    const field = fieldOf(issue.path);
    result[field] ??= isValidationMessage(issue.message) ? issue.message : 'invalid';
  }
  return result;
}

interface ParsedWindow {
  values: WindowValues;
  /** True when the request named a window (otherwise defaults are shown). */
  given: boolean;
  start?: string;
  end?: string;
  errors: SearchErrors;
}

function readWindow(params: SearchParams, now: number): ParsedWindow {
  const given = WINDOW_KEYS.some((key) => first(params[key]) !== '');
  const values = given
    ? {
        startDate: first(params.startDate),
        startTime: first(params.startTime),
        endDate: first(params.endDate),
        endTime: first(params.endTime),
      }
    : defaultWindow(now);
  const start = zonedTimeToUtc(values.startDate, values.startTime, DEFAULT_TIME_ZONE);
  const end = zonedTimeToUtc(values.endDate, values.endTime, DEFAULT_TIME_ZONE);
  const errors: SearchErrors = {};
  if (!start) errors.start = 'dateInvalid';
  if (!end) errors.end = 'dateInvalid';
  return { values, given, start: start?.toISOString(), end: end?.toISOString(), errors };
}

export interface ParsedSearch {
  values: SearchValues;
  /** False on a bare `/search` visit: show the form, no errors. */
  submitted: boolean;
  errors: SearchErrors;
  /** Present only when everything is valid. */
  query?: ParkingSearchQuery;
}

export function parseSearch(params: SearchParams, now = Date.now()): ParsedSearch {
  const area = first(params.area);
  // A chosen area wins over a previously shared position.
  const latitude = area ? '' : first(params.latitude);
  const longitude = area ? '' : first(params.longitude);
  const window = readWindow(params, now);
  const values = { area, latitude, longitude, ...window.values };
  const submitted = area !== '' || latitude !== '' || window.given;
  if (!submitted) return { values, submitted, errors: {} };

  const result = ParkingSearchQuerySchema.safeParse({
    area: area || undefined,
    latitude: latitude || undefined,
    longitude: longitude || undefined,
    start: window.start ?? '',
    end: window.end ?? '',
  });
  const errors = collect(result.error?.issues ?? [], window.errors);
  return {
    values,
    submitted,
    errors,
    query: result.success && Object.keys(errors).length === 0 ? result.data : undefined,
  };
}

export interface ParsedListingWindow {
  values: WindowValues;
  errors: SearchErrors;
  /** Present when a valid window was given. */
  window?: { start: string; end: string };
}

/** A listing page may carry the search window, to show availability and the total. */
export function parseListingWindow(params: SearchParams, now = Date.now()): ParsedListingWindow {
  const window = readWindow(params, now);
  if (!window.given) return { values: window.values, errors: {} };
  const result = ParkingListingQuerySchema.safeParse({ start: window.start, end: window.end });
  const errors = collect(result.error?.issues ?? [], window.errors);
  const valid = result.success && Object.keys(errors).length === 0 && window.start && window.end;
  return {
    values: window.values,
    errors,
    window: valid ? { start: window.start ?? '', end: window.end ?? '' } : undefined,
  };
}

/** Query string carrying a window to another page (e.g. from a result to its listing). */
export function windowQuery(values: WindowValues): Record<string, string> {
  return Object.fromEntries(WINDOW_KEYS.map((key) => [key, values[key]]));
}
