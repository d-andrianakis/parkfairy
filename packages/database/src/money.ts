import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { bookings } from './schema/bookings.js';
import { ledgerEntries, type LedgerKind } from './schema/payments.js';

/**
 * The money the worker moves (Phase 4.2), as the database sees it: what is owed, what is due, and
 * what was done, each written with its ledger entry in one transaction. Stripe is called between a
 * read here and a record here, never inside a transaction. Every sweep reads a page at a time,
 * after the last row of the one before, so a row that can't go yet never keeps the rest waiting;
 * one Stripe refused waits its turn again (`noteMoneyRetry`), longer each time.
 */

export const MONEY_PAGE_SIZE = 50;
const HOUR_MS = 60 * 60 * 1000;
/** An owner is paid 24 hours after the stay ends (decision #4). */
export const TRANSFER_AFTER_HOURS = 24;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Where a sweep's page ended: the next starts after it. The time is Postgres's own text, to the
 * microsecond: a JavaScript Date keeps milliseconds, and a row a few microseconds past one would
 * come back on every page.
 */
export interface MoneyCursor {
  at: string;
  id: string;
}

const after = (column: 'updated_at' | 'ends_at', cursor: MoneyCursor | undefined) =>
  cursor
    ? sql`and (b.${sql.raw(column)}, b.id) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
    : sql``;

/** Not waiting out a refusal from Stripe. */
const ready = sql`and (b.money_retry_at is null or b.money_retry_at <= now())`;

/** Back to none: what was owed went. */
const settled = { moneyAttempts: 0, moneyRetryAt: null } as const;

/**
 * One entry per kind per booking: writing it twice changes nothing, but a Stripe id learned late
 * (a charge named after the payment settled) fills in the one left without.
 */
async function enter(
  tx: Transaction | Database,
  entry: {
    bookingId: string;
    kind: LedgerKind;
    amountMinor: number;
    currency: string;
    stripeId?: string | null;
  },
): Promise<void> {
  if (entry.amountMinor <= 0) return;
  await tx
    .insert(ledgerEntries)
    .values({ ...entry, stripeId: entry.stripeId ?? null })
    .onConflictDoUpdate({
      target: [ledgerEntries.bookingId, ledgerEntries.kind],
      set: { stripeId: sql`coalesce(${ledgerEntries.stripeId}, excluded.stripe_id)` },
    });
}

/** The driver's payment, entered once the money is in (the API, as it settles a payment). */
export async function enterCharge(
  tx: Transaction | Database,
  booking: { id: string; currency: string },
  { amountMinor, chargeId }: { amountMinor: number; chargeId: string | null },
): Promise<void> {
  await enter(tx, {
    bookingId: booking.id,
    kind: 'charge',
    amountMinor,
    currency: booking.currency,
    stripeId: chargeId,
  });
}

/**
 * A charge id Stripe gave late (none when the payment settled): kept for the transfer, and the
 * charge entered, or its entry given the id.
 */
export async function recordCharge(
  db: Database,
  bookingId: string,
  { amountMinor, chargeId }: { amountMinor: number; chargeId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(bookings)
      .set({ stripeChargeId: chargeId })
      .where(and(eq(bookings.id, bookingId), sql`${bookings.stripeChargeId} is null`))
      .returning({ id: bookings.id, currency: bookings.currency });
    if (row) await enterCharge(tx, row, { amountMinor, chargeId });
  });
}

/**
 * Stripe refused (or couldn't be asked): the booking waits before the worker tries again, five
 * minutes, then twice as long each time, six hours at most. Its `updated_at` is left alone: it
 * says how long the money has been owed.
 */
export async function noteMoneyRetry(db: Database, bookingId: string): Promise<void> {
  await db.execute(sql`
    update ${bookings}
    set money_attempts = money_attempts + 1,
      money_retry_at = now() + least(
        interval '5 minutes' * power(2, least(money_attempts, 10)),
        interval '6 hours'
      )
    where id = ${bookingId}
  `);
}

export interface RefundOwed {
  id: string;
  paymentIntentId: string;
  /** `cancelled`: a cancellation's, by its policy; `unbooked`: a paid hold's, all of it (#3). */
  kind: 'cancelled' | 'unbooked';
  /** What the cancellation gives back; for an unbooked one, Stripe says (all it received). */
  amountMinor: number;
  /** When it was decided: past a day, Stripe's idempotency key no longer stands for it. */
  updatedAt: Date;
  cursor: MoneyCursor;
}

/**
 * Refunds decided before `before` and not yet with Stripe. The API asks Stripe right after
 * deciding, so only one that failed is here once `before` is past its own try.
 */
export async function refundsOwed(
  db: Database,
  before: Date,
  cursor?: MoneyCursor,
): Promise<RefundOwed[]> {
  const rows = await db.execute<{
    id: string;
    payment_intent_id: string;
    refund_status: string | null;
    refund_minor: number | null;
    total_minor: number;
    updated_at: string;
  }>(sql`
    select b.id, b.payment_intent_id, b.refund_status, b.refund_minor, b.total_minor,
      b.updated_at::text as updated_at
    from bookings b
    where (b.refund_status = 'owed' or b.payment_status = 'refunding')
      and b.payment_intent_id is not null
      and b.updated_at < ${before.toISOString()}::timestamptz
      ${ready}
      ${after('updated_at', cursor)}
    order by b.updated_at, b.id
    limit ${MONEY_PAGE_SIZE}
  `);
  return rows.rows.map((row) => ({
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    kind: row.refund_status === 'owed' ? ('cancelled' as const) : ('unbooked' as const),
    amountMinor: Number(row.refund_status === 'owed' ? (row.refund_minor ?? 0) : row.total_minor),
    updatedAt: new Date(row.updated_at),
    cursor: { at: row.updated_at, id: row.id },
  }));
}

/**
 * Refunds decided before `before` and still not with Stripe, whatever the worker can do: a day
 * on, a driver is waiting on their money, and support should know (with Stripe or without).
 */
export async function refundsStuck(db: Database, before: Date): Promise<number> {
  const rows = await db.execute<{ stuck: number }>(sql`
    select count(*)::int as stuck
    from bookings b
    where (b.refund_status = 'owed' or b.payment_status = 'refunding')
      and b.updated_at < ${before.toISOString()}::timestamptz
  `);
  return Number(rows.rows[0]?.stuck ?? 0);
}

/** A cancellation's refund Stripe has taken: recorded, and entered. */
export async function recordCancelRefund(
  db: Database,
  bookingId: string,
  refundId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(bookings)
      .set({ refundStatus: 'sent', stripeRefundId: refundId, ...settled })
      .where(and(eq(bookings.id, bookingId), eq(bookings.refundStatus, 'owed')))
      .returning({ refundMinor: bookings.refundMinor, currency: bookings.currency });
    if (row?.refundMinor) {
      await enter(tx, {
        bookingId,
        kind: 'refund',
        amountMinor: row.refundMinor,
        currency: row.currency,
        stripeId: refundId,
      });
    }
  });
}

/**
 * A paid hold's refund Stripe has taken (or had taken before our write was lost): recorded, and
 * entered at what Stripe says it received, all of which went back.
 */
export async function recordUnbookedRefund(
  db: Database,
  paymentIntentId: string,
  amountMinor: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(bookings)
      .set({ paymentStatus: 'refunded', ...settled })
      .where(
        and(eq(bookings.paymentIntentId, paymentIntentId), eq(bookings.paymentStatus, 'refunding')),
      )
      .returning({ id: bookings.id, currency: bookings.currency });
    if (row) {
      await enter(tx, { bookingId: row.id, kind: 'refund', amountMinor, currency: row.currency });
    }
  });
}

/**
 * A refund Stripe took and that failed after (a closed card): the money is back with the platform,
 * so it leaves the ledger, and a cancellation's says `failed`. Support settles it with the driver;
 * asking Stripe again would fail the same way. The booking it was for, if one of ours.
 */
export async function recordRefundFailed(
  db: Database,
  refund: { refundId: string; paymentIntentId: string | null; reason: string | null },
): Promise<string | null> {
  return db.transaction(async (tx) => {
    let bookingId: string | null = null;
    if (refund.reason === 'cancelled') {
      const [row] = await tx
        .update(bookings)
        .set({ refundStatus: 'failed' })
        .where(and(eq(bookings.stripeRefundId, refund.refundId), eq(bookings.refundStatus, 'sent')))
        .returning({ id: bookings.id });
      bookingId = row?.id ?? null;
    } else if (refund.reason === 'not_bookable' && refund.paymentIntentId) {
      const [row] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.paymentIntentId, refund.paymentIntentId),
            eq(bookings.paymentStatus, 'refunded'),
          ),
        );
      bookingId = row?.id ?? null;
    }
    if (bookingId) {
      await tx
        .delete(ledgerEntries)
        .where(and(eq(ledgerEntries.bookingId, bookingId), eq(ledgerEntries.kind, 'refund')));
    }
    return bookingId;
  });
}

export interface TransferDue {
  id: string;
  paymentIntentId: string | null;
  totalMinor: number;
  refundMinor: number;
  commissionBps: number;
  currency: string;
  chargeId: string | null;
  accountId: string;
  /** Set when a try was made before: the amounts it worked out, to send the same again. */
  sending: { transferMinor: number; commissionMinor: number; since: Date } | null;
  cursor: MoneyCursor;
}

/**
 * What makes a paid stay's transfer due at `dueBefore` (its end): confirmed, or cancelled with
 * something kept once its refund is settled with Stripe (what's kept is then final), not sent.
 */
const dueWhere = (dueBefore: Date) => sql`
  b.payment_status = 'succeeded'
  and b.status in ('confirmed', 'cancelled')
  and (b.transfer_status is null or b.transfer_status = 'sending')
  and b.ends_at <= ${dueBefore.toISOString()}::timestamptz
  and (b.refund_status is null or b.refund_status in ('sent', 'failed'))
  and (b.refund_minor is null or b.refund_minor < b.total_minor)
`;

/**
 * Paid stays over for 24 hours (#4) whose owner hasn't had their share and can be paid now. An
 * owner whose account Stripe has restricted waits (#52): `transfersWaiting` counts them.
 */
export async function transfersDue(
  db: Database,
  now: Date,
  cursor?: MoneyCursor,
): Promise<TransferDue[]> {
  const dueBefore = new Date(now.getTime() - TRANSFER_AFTER_HOURS * HOUR_MS);
  const rows = await db.execute<{
    id: string;
    payment_intent_id: string | null;
    total_minor: number;
    refund_minor: number | null;
    commission_bps: number;
    currency: string;
    stripe_charge_id: string | null;
    stripe_account_id: string;
    transfer_status: string | null;
    transfer_minor: number | null;
    commission_minor: number | null;
    updated_at: string;
    ends_at: string;
  }>(sql`
    select b.id, b.payment_intent_id, b.total_minor, b.refund_minor, b.commission_bps, b.currency,
      b.stripe_charge_id, pa.stripe_account_id, b.transfer_status, b.transfer_minor,
      b.commission_minor, b.updated_at::text as updated_at, b.ends_at::text as ends_at
    from bookings b
    join parking_locations l on l.id = b.location_id
    join payout_accounts pa on pa.owner_id = l.owner_id and pa.status = 'active'
    where ${dueWhere(dueBefore)}
      ${ready}
      ${after('ends_at', cursor)}
    order by b.ends_at, b.id
    limit ${MONEY_PAGE_SIZE}
  `);
  return rows.rows.map((row) => ({
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    totalMinor: Number(row.total_minor),
    refundMinor: Number(row.refund_minor ?? 0),
    commissionBps: Number(row.commission_bps),
    currency: row.currency,
    chargeId: row.stripe_charge_id,
    accountId: row.stripe_account_id,
    sending:
      row.transfer_status === 'sending' &&
      row.transfer_minor !== null &&
      row.commission_minor !== null
        ? {
            transferMinor: Number(row.transfer_minor),
            commissionMinor: Number(row.commission_minor),
            since: new Date(row.updated_at),
          }
        : null,
    cursor: { at: row.ends_at, id: row.id },
  }));
}

/**
 * Transfers due since before `dueSince` and still not sent: mostly an owner's account Stripe has
 * restricted (#52), for support to look into. How many, and for how many owners.
 */
export async function transfersWaiting(
  db: Database,
  dueSince: Date,
): Promise<{ bookings: number; owners: number }> {
  const endedBefore = new Date(dueSince.getTime() - TRANSFER_AFTER_HOURS * HOUR_MS);
  const rows = await db.execute<{ bookings: number; owners: number }>(sql`
    select count(*)::int as bookings, count(distinct l.owner_id)::int as owners
    from bookings b
    join parking_locations l on l.id = b.location_id
    where ${dueWhere(endedBefore)}
  `);
  const [row] = rows.rows;
  return { bookings: Number(row?.bookings ?? 0), owners: Number(row?.owners ?? 0) };
}

/**
 * The amounts worked out and about to be sent: kept, so a retry sends the same (#50, #51). Only
 * while the transfer is still due as it was read; false if it no longer is (then nothing goes).
 */
export async function markTransferSending(
  db: Database,
  bookingId: string,
  { transferMinor, commissionMinor }: { transferMinor: number; commissionMinor: number },
): Promise<boolean> {
  const rows = await db.execute(sql`
    update ${bookings} b
    set transfer_status = 'sending', transfer_minor = ${transferMinor},
      commission_minor = ${commissionMinor}, updated_at = now()
    where b.id = ${bookingId} and b.transfer_status is null
      and ${dueWhere(new Date(Date.now() - TRANSFER_AFTER_HOURS * HOUR_MS))}
    returning b.id
  `);
  return rows.rows.length === 1;
}

/** The transfer Stripe made: recorded, and entered with Parkfairy's commission. */
export async function recordTransfer(
  db: Database,
  bookingId: string,
  transferId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(bookings)
      .set({
        transferStatus: 'sent',
        stripeTransferId: transferId,
        transferredAt: new Date(),
        ...settled,
      })
      .where(and(eq(bookings.id, bookingId), eq(bookings.transferStatus, 'sending')))
      .returning({
        transferMinor: bookings.transferMinor,
        commissionMinor: bookings.commissionMinor,
        currency: bookings.currency,
      });
    if (!row) return;
    await enter(tx, {
      bookingId,
      kind: 'transfer',
      amountMinor: row.transferMinor ?? 0,
      currency: row.currency,
      stripeId: transferId,
    });
    await enter(tx, {
      bookingId,
      kind: 'commission',
      amountMinor: row.commissionMinor ?? 0,
      currency: row.currency,
    });
  });
}

export interface LapsedPayment {
  id: string;
  paymentIntentId: string;
  updatedAt: Date;
  cursor: MoneyCursor;
}

/**
 * PaymentIntents of holds that lapsed or were let go before `before`, unpaid: to call off at
 * Stripe, so nobody pays for a space no longer theirs and the row can go like any lapsed hold.
 * `before` leaves a late payment its time (#3).
 */
export async function lapsedPayments(
  db: Database,
  before: Date,
  cursor?: MoneyCursor,
): Promise<LapsedPayment[]> {
  const rows = await db.execute<{ id: string; payment_intent_id: string; updated_at: string }>(sql`
    select b.id, b.payment_intent_id, b.updated_at::text as updated_at
    from bookings b
    where b.payment_status = 'pending' and b.status in ('expired', 'released')
      and b.payment_intent_id is not null
      and b.updated_at < ${before.toISOString()}::timestamptz
      ${ready}
      ${after('updated_at', cursor)}
    order by b.updated_at, b.id
    limit ${MONEY_PAGE_SIZE}
  `);
  return rows.rows.map((row) => ({
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    updatedAt: new Date(row.updated_at),
    cursor: { at: row.updated_at, id: row.id },
  }));
}

/** Called off at Stripe: it can't be paid now, so the row is a lapsed hold like any other. */
export async function recordPaymentCanceled(db: Database, bookingId: string): Promise<void> {
  await db
    .update(bookings)
    .set({ paymentStatus: 'canceled', vehiclePlate: null, ...settled })
    .where(and(eq(bookings.id, bookingId), eq(bookings.paymentStatus, 'pending')));
}

/**
 * Bookings whose ledger doesn't add up, among those entered since `since` (the check runs daily,
 * so only what changed since the last run is read, each booking by its key). Nothing should ever
 * be here:
 * - a transfer sent, but charge − refund ≠ transfer + commission;
 * - a paid hold refunded, but charge ≠ refund;
 * - a cancellation's refund sent, but not the amount the booking says.
 */
export async function ledgerMismatches(db: Database, since: Date): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    with recent as (
      select distinct booking_id from ledger_entries
      where created_at >= ${since.toISOString()}::timestamptz
    )
    select b.id
    from recent r
    join bookings b on b.id = r.booking_id
    cross join lateral (
      select
        coalesce(sum(e.amount_minor) filter (where e.kind = 'charge'), 0) as charge,
        coalesce(sum(e.amount_minor) filter (where e.kind = 'refund'), 0) as refund,
        coalesce(sum(e.amount_minor) filter (where e.kind = 'transfer'), 0) as transfer,
        coalesce(sum(e.amount_minor) filter (where e.kind = 'commission'), 0) as commission
      from ledger_entries e
      where e.booking_id = r.booking_id
    ) s
    where (b.transfer_status = 'sent' and s.charge - s.refund <> s.transfer + s.commission)
      or (b.payment_status = 'refunded' and s.charge <> s.refund)
      or (b.refund_status = 'sent' and s.refund <> b.refund_minor)
    order by b.id
    limit 100
  `);
  return rows.rows.map((row) => row.id);
}
