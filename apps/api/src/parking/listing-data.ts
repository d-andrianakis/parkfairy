import { schema, type Database } from '@parkfairy/database';
import { and, asc, gte, inArray, lte, sql } from 'drizzle-orm';
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
/** A reader that can also send a statement of its own: a transaction, or the database. */
export type Executor = Pick<Database, 'execute'>;

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

type RuleRow = Pick<
  typeof rules.$inferSelect,
  'kind' | 'hourlyRateMinor' | 'fromMinute' | 'toMinute' | 'startsOn' | 'endsOn'
>;

/** One stored rule into the listing's prices. */
function addRule(target: PriceRules, rule: RuleRow) {
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

const noRules = (): PriceRules => ({
  weekendRateMinor: null,
  night: null,
  dated: [],
  discounts: [],
});

/**
 * Each listing's price rules, for the listing page and search. Two queries, one after the other
 * by default; `parallel` runs them at once, outside a transaction. A transaction that holds a
 * listing's lock reads them with `listingRulesIn` instead.
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
      found = noRules();
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
  for (const rule of ruleRows) addRule(entry(rule.locationId), rule);
  for (const { locationId, minDays, percent } of discountRows) {
    entry(locationId).discounts.push({ minDays, percent });
  }
  return byLocation;
}

export interface ListingRules {
  periods: OpeningPeriod[];
  exceptions: DatedHours[];
  /** Only when asked for. */
  prices: PriceRules | null;
}

/** A column's rows as one JSON array, `[]` for none. */
const rowsOf = (fields: Record<string, unknown>, order: ReturnType<typeof sql>) =>
  sql`coalesce(json_agg(json_build_object(${sql.join(
    Object.entries(fields).map(([name, column]) => sql`${name}::text, ${column}`),
    sql`, `,
  )}) order by ${order}), '[]'::json)`;

/**
 * One listing's weekly hours, its closures and special hours touching the days `from` to `to`,
 * and with `prices` its price rules: the same as `openingHoursOf`, `hoursExceptionsOf` and
 * `priceRulesOf`, in one statement. For a transaction holding the listing's lock (a hold, a
 * confirmation), where four reads one after another were four round trips under it.
 */
export async function listingRulesIn(
  db: Executor,
  locationId: string,
  from: string,
  to: string,
  { prices }: { prices: boolean },
): Promise<ListingRules> {
  const [found] = (
    await db.execute<{
      periods: OpeningPeriod[];
      exceptions: DatedHours[];
      rules: RuleRow[] | null;
      discounts: { minDays: number; percent: number }[] | null;
    }>(sql`select
      (select ${rowsOf(
        {
          weekday: hours.weekday,
          opensMinute: hours.opensMinute,
          closesMinute: hours.closesMinute,
        },
        sql`${hours.weekday}, ${hours.opensMinute}`,
      )} from ${hours} where ${hours.locationId} = ${locationId}) as periods,
      (select ${rowsOf(
        {
          startsOn: exception.startsOn,
          endsOn: exception.endsOn,
          opensMinute: exception.opensMinute,
          closesMinute: exception.closesMinute,
          closedFromMinute: exception.closedFromMinute,
          closedToMinute: exception.closedToMinute,
        },
        sql`${exception.startsOn}`,
      )} from ${exception} where ${exception.locationId} = ${locationId}
        and ${exception.endsOn} >= ${from}::date and ${exception.startsOn} <= ${to}::date) as exceptions,
      ${
        prices
          ? sql`(select ${rowsOf(
              {
                kind: rules.kind,
                hourlyRateMinor: rules.hourlyRateMinor,
                fromMinute: rules.fromMinute,
                toMinute: rules.toMinute,
                startsOn: rules.startsOn,
                endsOn: rules.endsOn,
              },
              sql`${rules.startsOn}`,
            )} from ${rules} where ${rules.locationId} = ${locationId}) as rules,
            (select ${rowsOf(
              { minDays: discounts.minDays, percent: discounts.percent },
              sql`${discounts.minDays}`,
            )} from ${discounts} where ${discounts.locationId} = ${locationId}) as discounts`
          : sql`null as rules, null as discounts`
      }`)
  ).rows;
  if (!found) throw new Error('No row from a select without a table');
  let priced: PriceRules | null = null;
  if (prices) {
    priced = noRules();
    for (const rule of found.rules ?? []) addRule(priced, rule);
    priced.discounts = found.discounts ?? [];
  }
  return { periods: found.periods, exceptions: found.exceptions, prices: priced };
}
