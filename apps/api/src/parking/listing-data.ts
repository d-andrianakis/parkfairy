import { schema, type Database } from '@parkfairy/database';
import { and, asc, gte, inArray, lte } from 'drizzle-orm';
import type { DatedHours, OpeningPeriod } from './opening-hours.js';
import type { PriceRules } from './pricing.js';

const hours = schema.parkingOpeningHours;
const exception = schema.parkingHoursExceptions;
const rules = schema.parkingPriceRules;
const discounts = schema.parkingStayDiscounts;

/**
 * What reads a listing's hours and prices: the database, or a transaction that has locked the
 * listing. Each loader runs its queries one after another where a transaction may call it, since
 * one connection can't run two at once.
 */
export type Reader = Pick<Database, 'select'>;

/** The UTC calendar day of an instant: within a day of the local one, whatever the zone. */
export const utcDay = (instant: Date) => instant.toISOString().slice(0, 10);

function group<T extends { locationId: string }>(rows: T[]): Map<string, Omit<T, 'locationId'>[]> {
  const byLocation = new Map<string, Omit<T, 'locationId'>[]>();
  for (const { locationId, ...rest } of rows) {
    const list = byLocation.get(locationId);
    if (list) list.push(rest);
    else byLocation.set(locationId, [rest]);
  }
  return byLocation;
}

export async function openingHoursOf(
  db: Reader,
  locationIds: string[],
): Promise<Map<string, OpeningPeriod[]>> {
  if (locationIds.length === 0) return new Map();
  return group(
    await db
      .select({
        locationId: hours.locationId,
        weekday: hours.weekday,
        opensMinute: hours.opensMinute,
        closesMinute: hours.closesMinute,
      })
      .from(hours)
      .where(inArray(hours.locationId, locationIds))
      .orderBy(asc(hours.weekday), asc(hours.opensMinute)),
  );
}

/** Closures and special hours that touch the days from `from` (to `to`), soonest first. */
export async function hoursExceptionsOf(
  db: Reader,
  locationIds: string[],
  from: string,
  to?: string,
): Promise<Map<string, DatedHours[]>> {
  if (locationIds.length === 0) return new Map();
  return group(
    await db
      .select({
        locationId: exception.locationId,
        startsOn: exception.startsOn,
        endsOn: exception.endsOn,
        opensMinute: exception.opensMinute,
        closesMinute: exception.closesMinute,
        closedFromMinute: exception.closedFromMinute,
        closedToMinute: exception.closedToMinute,
      })
      .from(exception)
      .where(
        and(
          inArray(exception.locationId, locationIds),
          gte(exception.endsOn, from),
          to === undefined ? undefined : lte(exception.startsOn, to),
        ),
      )
      .orderBy(asc(exception.startsOn)),
  );
}

/**
 * Each listing's price rules, for a quote and the listing page. Two queries, one after the other
 * by default, as a transaction (the hold's) must; `parallel` runs them at once, outside one.
 */
export async function priceRulesOf(
  db: Reader,
  locationIds: string[],
  { parallel = false }: { parallel?: boolean } = {},
): Promise<Map<string, PriceRules>> {
  const byLocation = new Map<string, PriceRules>();
  if (locationIds.length === 0) return byLocation;
  const entry = (locationId: string) => {
    let found = byLocation.get(locationId);
    if (!found) {
      found = { weekendRateMinor: null, night: null, dated: [], discounts: [] };
      byLocation.set(locationId, found);
    }
    return found;
  };
  const ruleQuery = () =>
    db
      .select()
      .from(rules)
      .where(inArray(rules.locationId, locationIds))
      .orderBy(asc(rules.startsOn));
  const discountQuery = () =>
    db
      .select({
        locationId: discounts.locationId,
        minDays: discounts.minDays,
        percent: discounts.percent,
      })
      .from(discounts)
      .where(inArray(discounts.locationId, locationIds))
      .orderBy(asc(discounts.minDays));
  const [ruleRows, discountRows] = parallel
    ? await Promise.all([ruleQuery(), discountQuery()])
    : [await ruleQuery(), await discountQuery()];
  for (const rule of ruleRows) {
    const target = entry(rule.locationId);
    if (rule.kind === 'weekend') target.weekendRateMinor = rule.hourlyRateMinor;
    else if (rule.kind === 'night' && rule.fromMinute !== null && rule.toMinute !== null) {
      target.night = {
        rateMinor: rule.hourlyRateMinor,
        fromMinute: rule.fromMinute,
        toMinute: rule.toMinute,
      };
    } else if (rule.kind === 'dated' && rule.startsOn && rule.endsOn) {
      target.dated.push({
        startsOn: rule.startsOn,
        endsOn: rule.endsOn,
        rateMinor: rule.hourlyRateMinor,
      });
    }
  }
  for (const { locationId, minDays, percent } of discountRows) {
    entry(locationId).discounts.push({ minDays, percent });
  }
  return byLocation;
}
