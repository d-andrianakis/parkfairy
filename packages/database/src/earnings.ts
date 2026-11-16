import {
  DEFAULT_TIME_ZONE,
  EARNINGS_IN_PROGRESS_MAX,
  EARNINGS_MONTHS,
  EARNINGS_PAGE_SIZE,
} from '@parkfairy/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { heldByDispute, lostByOwners, TRANSFER_AFTER_HOURS } from './money.js';

/**
 * What one owner has earned (5.1): their own `booking_payees` rows and nothing of another payee's,
 * so the owner id is in every query and the caller gets it from the signed-in user, never from the
 * request. Amounts are the part the worker worked out (#50, #51, #54): a booking whose stay isn't
 * over yet has none, and is only counted.
 */

const HOUR_MS = 60 * 60 * 1000;

export interface EarningRow {
  id: string;
  reference: string;
  listingId: string;
  listingName: string | null;
  contentLocale: string;
  endsAt: Date;
  state: 'sending' | 'sent';
  amountMinor: number;
  currency: string;
  sentAt: Date | null;
  hold: 'account' | 'dispute' | 'lost' | null;
}

export interface OwnerEarningsRows {
  sentMinor: number;
  sendingMinor: number;
  coming: number;
  held: { account: number; dispute: number };
  months: { month: string; amountMinor: number }[];
  listings: {
    id: string;
    name: string | null;
    contentLocale: string;
    amountMinor: number;
  }[];
  inProgress: EarningRow[];
  /** One more than a page when there is a next. */
  lines: EarningRow[];
}

type RawRow = {
  id: string;
  reference: string;
  listing_id: string;
  name: string | null;
  content_locale: string;
  ends_at: string;
  state: 'sending' | 'sent';
  amount_minor: number;
  currency: string;
  sent_at: string | null;
  hold: 'account' | 'dispute' | 'lost' | null;
};

const toRow = (row: RawRow): EarningRow => ({
  id: row.id,
  reference: row.reference,
  listingId: row.listing_id,
  listingName: row.name,
  contentLocale: row.content_locale,
  endsAt: new Date(row.ends_at),
  state: row.state,
  amountMinor: Number(row.amount_minor),
  currency: row.currency,
  sentAt: row.sent_at === null ? null : new Date(row.sent_at),
  hold: row.hold,
});

/** A booking's part as a line: why it hasn't gone is told for the ones worked out and not sent. */
const lineColumns = sql`
  p.id, b.reference, l.id as listing_id, l.name, l.content_locale,
  b.ends_at::text as ends_at, p.transfer_status as state, p.transfer_minor as amount_minor,
  b.currency, p.transferred_at::text as sent_at,
  case
    when p.transfer_status = 'sent' then null
    when exists (${lostByOwners}) then 'lost'
    when exists (${heldByDispute}) then 'dispute'
    when p.transfer_minor > 0 and pa.status is distinct from 'active' then 'account'
  end as hold
`;
const lineTables = sql`
  from booking_payees p
  join bookings b on b.id = p.booking_id
  join parking_locations l on l.id = b.location_id
  left join payout_accounts pa on pa.owner_id = p.owner_id
`;

const NONE = { rows: [] as never[] };

/** `after`: the place a page ended at, the sent time and the payee row's id. */
export async function ownerEarnings(
  db: Database,
  ownerId: string,
  now: Date,
  after?: { sentAt: Date; id: string },
): Promise<OwnerEarningsRows> {
  const instant = now.toISOString();
  const dueBefore = new Date(now.getTime() - TRANSFER_AFTER_HOURS * HOUR_MS).toISOString();
  const zone = sql.raw(`'${DEFAULT_TIME_ZONE}'`);
  // A few at a time: one request holds a few of the API's pool connections, not all six.
  const [totals, coming] = await Promise.all([
    db.execute<{ sent: string; sending: string }>(sql`
      select
        coalesce(sum(p.transfer_minor) filter (where p.transfer_status = 'sent'), 0)::text as sent,
        coalesce(sum(p.transfer_minor) filter (where p.transfer_status = 'sending'), 0)::text as sending
      from booking_payees p
      where p.owner_id = ${ownerId} and p.transfer_status is not null
    `),
    // Paid, not worked out yet, and not wholly given back: with how many are held, and by what.
    db.execute<{ coming: number; account: number; dispute: number }>(sql`
      select
        count(*)::int as coming,
        count(*) filter (where exists (${heldByDispute}))::int as dispute,
        count(*) filter (
          where not exists (${heldByDispute}) and b.ends_at <= ${dueBefore}::timestamptz
            and pa.status is distinct from 'active'
        )::int as account
      from booking_payees p
      join bookings b on b.id = p.booking_id
      left join payout_accounts pa on pa.owner_id = p.owner_id
      where p.owner_id = ${ownerId} and p.transfer_status is null
        and b.payment_status = 'succeeded' and b.status in ('confirmed', 'cancelled')
        and (b.refund_minor is null or b.refund_minor < b.total_minor)
        -- Never paid, by staff's decision (#83): not coming.
        and not exists (${lostByOwners})
    `),
  ]);
  const [lines, inProgress] = await Promise.all([
    // The place compares as a pair, on `booking_payees_owner_sent_idx`.
    db.execute<RawRow>(sql`
      select ${lineColumns} ${lineTables}
      where p.owner_id = ${ownerId} and p.transfer_status = 'sent'
        ${
          after
            ? sql`and (p.transferred_at, p.id) < (${after.sentAt.toISOString()}::timestamptz, ${after.id}::uuid)`
            : sql``
        }
      order by p.transferred_at desc nulls last, p.id desc nulls last
      limit ${EARNINGS_PAGE_SIZE + 1}
    `),
    // What is on its way is the same on every page: the first one shows it.
    after
      ? Promise.resolve(NONE)
      : db.execute<RawRow>(sql`
      select ${lineColumns} ${lineTables}
      where p.owner_id = ${ownerId} and p.transfer_status = 'sending'
      order by b.ends_at, p.id
      limit ${EARNINGS_IN_PROGRESS_MAX}
    `),
  ]);
  // The same, and costly for an owner with a long history: not read again for a later page.
  const [months, listings] = after
    ? [NONE, NONE]
    : await Promise.all([
        db.execute<{ month: string; amount_minor: string }>(sql`
      select to_char(p.transferred_at at time zone ${zone}, 'YYYY-MM') as month,
        sum(p.transfer_minor)::text as amount_minor
      from booking_payees p
      where p.owner_id = ${ownerId} and p.transfer_status = 'sent'
        and p.transferred_at >= (
          date_trunc('month', ${instant}::timestamptz at time zone ${zone})
            - make_interval(months => ${EARNINGS_MONTHS - 1})
        ) at time zone ${zone}
      group by 1
      order by 1 desc
    `),
        db.execute<{
          id: string;
          name: string | null;
          content_locale: string;
          amount_minor: string;
        }>(sql`
      select l.id, l.name, l.content_locale, sum(p.transfer_minor)::text as amount_minor
      from booking_payees p
      join bookings b on b.id = p.booking_id
      join parking_locations l on l.id = b.location_id
      where p.owner_id = ${ownerId} and p.transfer_status = 'sent'
      group by l.id
      order by sum(p.transfer_minor) desc, l.id
      limit 100
    `),
      ]);
  const [sum] = totals.rows;
  const [count] = coming.rows;
  return {
    sentMinor: Number(sum?.sent ?? 0),
    sendingMinor: Number(sum?.sending ?? 0),
    coming: Number(count?.coming ?? 0),
    held: { account: Number(count?.account ?? 0), dispute: Number(count?.dispute ?? 0) },
    months: months.rows.map((row) => ({ month: row.month, amountMinor: Number(row.amount_minor) })),
    listings: listings.rows.map((row) => ({
      id: row.id,
      name: row.name,
      contentLocale: row.content_locale,
      amountMinor: Number(row.amount_minor),
    })),
    inProgress: inProgress.rows.map(toRow),
    lines: lines.rows.map(toRow),
  };
}
