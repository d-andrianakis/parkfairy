import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type {
  Place,
  PlaceRetrieveQuery,
  PlaceSearchQuery,
  PlaceSuggestion,
  PlaceSuggestQuery,
} from '@parkfairy/contracts';
import type { Redis } from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { RATE_LIMIT_REDIS } from '../rate-limit/rate-limit.module.js';
import {
  findPlaces,
  MapboxError,
  retrievePlace,
  suggestPlaces,
  type FetchFn,
} from './mapbox-search.js';
import { PlacesBudget } from './places-budget.js';

export const PLACES_FETCH = Symbol('PLACES_FETCH');

const REPORT_INTERVAL_MS = 10_000;
/** Mapbox failing this many times running is down: answer at once for a while, not after 3 s each. */
const BREAKER_FAILURES = 5;
const BREAKER_OPEN_MS = 30_000;

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message: 'PLACES_UNAVAILABLE',
    code: 'PLACES_UNAVAILABLE',
  });
}

/**
 * Address search on the browser's behalf (decision #40). With no token, past the hour's budget, or
 * when Mapbox fails, the answer is `PLACES_UNAVAILABLE`, and the search form says to choose an area
 * instead. Nothing Mapbox returns is kept.
 */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly budget: PlacesBudget;
  private lastReportAt = Number.NEGATIVE_INFINITY;
  private suppressed = 0;
  private failuresInARow = 0;
  private closedUntil = 0;

  constructor(
    @Inject(ENV)
    private readonly env: Pick<Env, 'mapboxSearchToken' | 'MAPBOX_SEARCH_HOURLY_LIMIT'>,
    @Inject(RATE_LIMIT_REDIS) redis: Redis | null,
    @Inject(PLACES_FETCH) private readonly fetchFn: FetchFn,
  ) {
    this.budget = new PlacesBudget(env.MAPBOX_SEARCH_HOURLY_LIMIT, redis, (error) =>
      this.report('Places budget storage failed; counted per instance', { err: error }),
    );
  }

  /** A session's calls cost the budget once, as Mapbox bills them. */
  suggest({ q, session, locale }: PlaceSuggestQuery): Promise<PlaceSuggestion[]> {
    return this.run(session, (token) =>
      suggestPlaces({ q, session, locale, token, fetchFn: this.fetchFn }),
    );
  }

  retrieve({ id, session, locale }: PlaceRetrieveQuery): Promise<Place | null> {
    return this.run(session, (token) =>
      retrievePlace({ id, session, locale, token, fetchFn: this.fetchFn }),
    );
  }

  /** Billed per call. */
  find({ q, locale }: PlaceSearchQuery): Promise<Place[]> {
    return this.run(undefined, (token) => findPlaces({ q, locale, token, fetchFn: this.fetchFn }));
  }

  private async run<T>(session: string | undefined, call: (token: string) => Promise<T>) {
    const token = this.env.mapboxSearchToken;
    if (!token || Date.now() < this.closedUntil) throw unavailable();
    if (!(await this.budget.spend(session))) {
      this.report('Places budget for this hour spent; address search refused');
      throw unavailable();
    }
    try {
      const result = await call(token);
      this.failuresInARow = 0;
      return result;
    } catch (error) {
      if (!(error instanceof MapboxError)) throw error;
      this.failuresInARow += 1;
      if (this.failuresInARow >= BREAKER_FAILURES) {
        this.closedUntil = Date.now() + BREAKER_OPEN_MS;
        this.failuresInARow = 0;
      }
      // A refused token (401/403) or a shape we don't know needs someone; say so, not too often.
      this.report('Mapbox search failed', { status: error.status });
      throw unavailable();
    }
  }

  /** At most one line every 10 s, with how many were held back meanwhile. */
  private report(message: string, details: Record<string, unknown> = {}) {
    const now = Date.now();
    if (now - this.lastReportAt < REPORT_INTERVAL_MS) {
      this.suppressed += 1;
      return;
    }
    this.logger.warn({ ...details, suppressed: this.suppressed }, message);
    this.lastReportAt = now;
    this.suppressed = 0;
  }
}
