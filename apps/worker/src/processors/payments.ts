import {
  disputesToAnswer,
  lapsedPayments,
  ledgerMismatches,
  lostDisputesHeld,
  markTransferSending,
  MONEY_PAGE_SIZE,
  type MoneyCursor,
  noteMoneyRetry,
  recordCancelRefund,
  recordCharge,
  recordPayeeTransfer,
  recordPaymentCanceled,
  recordUnbookedRefund,
  refundsOwed,
  refundsStuck,
  transferHeld,
  transfersDue,
  transfersWaiting,
} from '@parkfairy/database';
import {
  PaymentProviderError,
  type PaymentsGateway,
  sharesOf,
  splitShares,
} from '@parkfairy/payments';

import { type ProcessorContext, type QueueProcessor, QUEUES } from '../queues.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The API asks Stripe for a refund right after deciding it: the worker only finishes one that failed. */
export const REFUND_GRACE_MS = 5 * MINUTE_MS;
/** A lapsed hold's payment is called off an hour on, leaving a late payment its time (#3). */
export const LAPSED_PAYMENT_MS = HOUR_MS;
/**
 * A dispute due within this many days with nothing sent to the bank is support's to answer now:
 * past its deadline it is lost (#59: the evidence is staged, never submitted for them).
 */
export const DISPUTE_DUE_ALERT_DAYS = 3;
/** A transfer waiting this long, mostly on a restricted account, is support's to look into (#52). */
export const TRANSFER_WAIT_ALERT_DAYS = 3;
/**
 * Stripe keeps an idempotency key's answer for a day: inside it, asking again with the key is the
 * same refund or transfer. Past it (an hour spared), Stripe is asked what it made first.
 */
export const KEY_DAY_MS = 23 * HOUR_MS;
/** Pages one sweep reads at most; the next run takes the rest. */
export const MAX_PAGES = 20;
/**
 * Stripe down, slow or refusing us outright (`api_error`, a timeout, rate limits) this many times
 * in a row: the run stops, and the next tries again, rather than spend minutes per row failing.
 */
export const OUTAGE_FAILURES = 3;
const OUTAGE = /^(api_error|api_connection_error|StripeConnectionError|StripeAPIError)|rate_limit/;

/** Only what a failure may say in our logs: Stripe's type and code, never its message. */
function detailOf(error: unknown): string {
  if (error instanceof PaymentProviderError) return error.detail;
  return error instanceof Error ? error.name : 'unknown';
}

interface Swept {
  done: number;
  failed: number;
}

interface SweepOptions<Row> {
  /** How long the run may take: less than its schedule, so one never waits on another. */
  runMs: number;
  /** How a failure for this row is said: a day old, it is support's (an error). */
  failure: (row: Row) => { level: 'warn' | 'error'; message: string };
}

/**
 * Reads a sweep page after page, after the last row of the one before (a row that can't go yet
 * keeps nothing waiting), handing each row on. A row Stripe refused waits its turn again, longer
 * each time (`noteMoneyRetry`). Stops when the worker does, when its time is up, or when Stripe
 * looks down.
 */
async function sweep<Row extends { id: string; cursor: MoneyCursor }>(
  read: (cursor: MoneyCursor | undefined) => Promise<Row[]>,
  each: (row: Row) => Promise<boolean>,
  { db, logger, signal }: Pick<ProcessorContext, 'db' | 'logger' | 'signal'>,
  { runMs, failure }: SweepOptions<Row>,
): Promise<Swept> {
  const swept: Swept = { done: 0, failed: 0 };
  const deadline = Date.now() + runMs;
  let outages = 0;
  let cursor: MoneyCursor | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await read(cursor);
    for (const row of rows) {
      if (signal?.aborted || Date.now() >= deadline) return swept;
      try {
        if (await each(row)) swept.done++;
        outages = 0;
      } catch (error) {
        swept.failed++;
        const detail = detailOf(error);
        const { level, message } = failure(row);
        logger[level]({ bookingId: row.id, detail }, message);
        await noteMoneyRetry(db, row.id);
        outages = OUTAGE.test(detail) ? outages + 1 : 0;
        if (outages >= OUTAGE_FAILURES) {
          logger.warn({ detail }, 'Stripe looks down: the rest waits for the next run');
          return swept;
        }
      }
    }
    const last = rows.at(-1);
    if (!last || rows.length < MONEY_PAGE_SIZE) break;
    cursor = last.cursor;
  }
  return swept;
}

/** Refunds the API couldn't send: a cancellation's (by its policy), or a paid hold's (all of it). */
async function sendRefunds(payments: PaymentsGateway, ctx: ProcessorContext): Promise<Swept> {
  const { db } = ctx;
  const now = Date.now();
  return sweep(
    (cursor) => refundsOwed(db, new Date(Date.now() - REFUND_GRACE_MS), cursor),
    async (owed) => {
      if (owed.kind === 'cancelled') {
        // Inside the key's day, the key is enough; past it, made already is recorded, never twice.
        const made =
          owed.updatedAt.getTime() < now - KEY_DAY_MS
            ? await payments.refundMadeFor(owed.paymentIntentId)
            : null;
        const id =
          made ??
          (await payments.refundCancelled({
            paymentIntentId: owed.paymentIntentId,
            bookingId: owed.id,
            amountMinor: owed.amountMinor,
            attempt: owed.attempt,
          }));
        await recordCancelRefund(db, owed.id, id);
        return true;
      }
      const state = await payments.payment(owed.paymentIntentId);
      const refundedAlready = state.receivedMinor > 0 && state.refundedMinor >= state.receivedMinor;
      if (!refundedAlready) await payments.refundPayment(state.id, 'not_bookable');
      await recordUnbookedRefund(db, state.id, state.receivedMinor);
      return true;
    },
    ctx,
    {
      runMs: 4 * MINUTE_MS,
      // A driver a day without the money they're owed: support should know.
      failure: (owed) =>
        owed.updatedAt.getTime() < now - DAY_MS
          ? { level: 'error', message: 'refund owed for over a day' }
          : { level: 'warn', message: 'refund not sent yet' },
    },
  );
}

/**
 * Owners' shares, 24 hours after each paid stay (#4): 90% of what's kept (#50, #51), split
 * between the booking's payees by their shares (#54), worked out once and kept, so every retry
 * sends the same. Each payee is paid on their own: one whose account Stripe has restricted waits
 * (#52) while the others are paid, and `check-money` says when one has waited for days.
 */
async function sendTransfers(payments: PaymentsGateway, ctx: ProcessorContext): Promise<Swept> {
  const { db, logger } = ctx;
  const now = new Date();
  return sweep(
    (cursor) => transfersDue(db, now, cursor),
    async (due) => {
      let chargeId = due.chargeId;
      if (!chargeId) {
        // None when the payment settled: Stripe has it now.
        if (!due.paymentIntentId) throw new Error('A paid booking without its PaymentIntent');
        const state = await payments.payment(due.paymentIntentId);
        if (!state.chargeId) throw new PaymentProviderError('no charge');
        await recordCharge(db, due.id, {
          amountMinor: state.receivedMinor,
          chargeId: state.chargeId,
        });
        chargeId = state.chargeId;
      }
      if (due.payees.length === 0) throw new Error('A paid booking without payees');
      let parts: ReadonlyMap<string, number>;
      if (due.sending) {
        parts = new Map(due.payees.map((payee) => [payee.ownerId, payee.transferMinor ?? 0]));
      } else {
        const shares = sharesOf({
          totalMinor: due.totalMinor,
          refundMinor: due.refundMinor,
          commissionBps: due.commissionBps,
        });
        if (shares.ownerMinor <= 0) {
          // Only a commission of (nearly) all of it could do this: nothing to send, and support's.
          logger.error({ bookingId: due.id, ...shares }, 'nothing to transfer to the owner');
          await noteMoneyRetry(db, due.id);
          return false;
        }
        // Split between the payees by their shares (#54), worked out once and kept with them.
        parts = splitShares(shares.ownerMinor, due.payees);
        const amounts = {
          transferMinor: shares.ownerMinor,
          commissionMinor: shares.commissionMinor,
        };
        // Still due as it was read (another run, a change since): if not, nothing goes.
        if (!(await markTransferSending(db, due.id, amounts, parts))) return false;
      }
      // Asked over a day ago: Stripe may have made one, its key forgotten since.
      const keyForgotten =
        due.sending !== null && due.sending.since.getTime() < now.getTime() - KEY_DAY_MS;
      let paid = 0;
      for (const payee of due.payees) {
        if (payee.sent) continue;
        const part = parts.get(payee.ownerId) ?? 0;
        if (part > 0 && (!payee.active || !payee.accountId)) {
          // Their account can't be paid now (#52): theirs waits, the others' go.
          continue;
        }
        const made =
          part > 0 && keyForgotten
            ? await payments.transferMadeFor(due.id, payee.ownerId, { primary: payee.primary })
            : null;
        // A dispute recorded since the page was read holds the rest (#58): asked before each
        // transfer, as recording one takes the booking's lock and this page may be minutes old.
        if (part > 0 && !made && (await transferHeld(db, due.id))) break;
        const transferId =
          part === 0
            ? null
            : (made ??
              (await payments.transfer({
                bookingId: due.id,
                ownerId: payee.ownerId,
                accountId: payee.accountId ?? '',
                amountMinor: part,
                currency: due.currency,
                chargeId,
              })));
        await recordPayeeTransfer(db, due.id, payee.ownerId, transferId);
        paid++;
      }
      return paid > 0;
    },
    ctx,
    { runMs: 12 * MINUTE_MS, failure: () => ({ level: 'warn', message: 'transfer not sent yet' }) },
  );
}

/**
 * PaymentIntents of holds that lapsed unpaid, called off at Stripe so nobody pays for a space no
 * longer theirs, and so the row can go like any lapsed hold. One paid meanwhile is the API's: its
 * webhook confirms or refunds it (#3); it is looked at again later, less and less often.
 */
async function cancelLapsedPayments(
  payments: PaymentsGateway,
  ctx: ProcessorContext,
): Promise<Swept> {
  const { db, logger } = ctx;
  const dayAgo = Date.now() - DAY_MS;
  return sweep(
    (cursor) => lapsedPayments(db, new Date(Date.now() - LAPSED_PAYMENT_MS), cursor),
    async (lapsed) => {
      const state = await payments.cancelPayment(lapsed.paymentIntentId);
      if (state.status === 'canceled') {
        await recordPaymentCanceled(db, lapsed.id);
        return true;
      }
      // A day on and still not settled: Stripe's webhook never came.
      const stuck = lapsed.updatedAt.getTime() < dayAgo;
      logger[stuck ? 'error' : 'info'](
        { bookingId: lapsed.id, status: state.status },
        stuck ? 'lapsed hold paid, unsettled for a day' : 'lapsed hold paid meanwhile',
      );
      await noteMoneyRetry(db, lapsed.id);
      return false;
    },
    ctx,
    {
      runMs: 12 * MINUTE_MS,
      failure: () => ({ level: 'warn', message: 'lapsed payment not called off yet' }),
    },
  );
}

/**
 * The day's look at the money, with Stripe or without (it only reads): the ledger adds up for
 * everything entered since the last look, no refund has been owed for a day, no owner's transfer
 * has waited for days (#52), no dispute is about to go unanswered (#59), and no lost one still
 * waits on support's decision (#57). What it finds is support's (error logs).
 */
async function checkMoney({ db, logger }: ProcessorContext, now: Date) {
  // Two days back: a run late or missed still overlaps the one before.
  const mismatched = await ledgerMismatches(db, new Date(now.getTime() - 2 * DAY_MS));
  if (mismatched.length > 0) {
    logger.error({ bookingIds: mismatched }, 'ledger does not add up');
  }
  const stuck = await refundsStuck(db, new Date(now.getTime() - DAY_MS));
  if (stuck > 0) logger.error({ refunds: stuck }, 'refunds owed for over a day');
  const waiting = await transfersWaiting(
    db,
    new Date(now.getTime() - TRANSFER_WAIT_ALERT_DAYS * DAY_MS),
  );
  if (waiting.bookings > 0) {
    logger.error(waiting, `transfers waiting over ${TRANSFER_WAIT_ALERT_DAYS} days`);
  }
  const unanswered = await disputesToAnswer(
    db,
    new Date(now.getTime() + DISPUTE_DUE_ALERT_DAYS * DAY_MS),
  );
  if (unanswered > 0) {
    logger.error(
      { disputes: unanswered },
      `disputes due within ${DISPUTE_DUE_ALERT_DAYS} days, nothing submitted`,
    );
  }
  const lost = await lostDisputesHeld(db);
  if (lost > 0) logger.error({ disputes: lost }, 'lost disputes waiting on support’s decision');
  return { mismatched: mismatched.length, stuck, waiting: waiting.bookings, unanswered, lost };
}

const SWEEPS: Record<string, (payments: PaymentsGateway, ctx: ProcessorContext) => Promise<Swept>> =
  {
    'send-refunds': sendRefunds,
    'send-transfers': sendTransfers,
    'cancel-lapsed-payments': cancelLapsedPayments,
  };

export const paymentsProcessor: QueueProcessor = {
  queue: QUEUES.payments,
  concurrency: 1,
  // One sweep at a time over every worker process: two would ask Stripe for the same thing. Each
  // run's own limit keeps the others' turns short.
  globalConcurrency: 1,
  schedules: [
    { id: 'send-refunds', everyMs: 5 * MINUTE_MS },
    { id: 'send-transfers', everyMs: 15 * MINUTE_MS },
    { id: 'cancel-lapsed-payments', everyMs: 15 * MINUTE_MS },
    { id: 'check-money', everyMs: DAY_MS },
  ],
  async process(job, ctx) {
    if (job.name === 'check-money') return checkMoney(ctx, new Date());
    const run = Object.hasOwn(SWEEPS, job.name) ? SWEEPS[job.name] : undefined;
    if (!run) throw new Error(`Unknown payments job "${job.name}"`);
    // Without Stripe nothing was paid for, so nothing is owed or due.
    if (!ctx.payments) return { skipped: true };
    const swept = await run(ctx.payments, ctx);
    if (swept.done > 0 || swept.failed > 0) ctx.logger.info(swept, `${job.name} done`);
    return swept;
  },
};
