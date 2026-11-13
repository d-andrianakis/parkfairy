import {
  lapsedPayments,
  ledgerMismatches,
  markTransferSending,
  noteMoneyRetry,
  recordCancelRefund,
  recordCharge,
  recordPaymentCanceled,
  recordTransfer,
  recordUnbookedRefund,
  refundsOwed,
  refundsStuck,
  transfersDue,
  transfersWaiting,
  type Database,
  type LapsedPayment,
  type RefundOwed,
  type TransferDue,
} from '@parkfairy/database';
import { PaymentProviderError, type PaymentState, type PaymentsGateway } from '@parkfairy/payments';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUES, type ProcessorContext } from '../queues.js';
import {
  KEY_DAY_MS,
  LAPSED_PAYMENT_MS,
  MAX_PAGES,
  OUTAGE_FAILURES,
  paymentsProcessor,
  REFUND_GRACE_MS,
  TRANSFER_WAIT_ALERT_DAYS,
} from './payments.js';

// Pages of two, so a test can see the sweep go on to the next.
vi.mock('@parkfairy/database', () => ({
  MONEY_PAGE_SIZE: 2,
  lapsedPayments: vi.fn(),
  ledgerMismatches: vi.fn(),
  markTransferSending: vi.fn(),
  noteMoneyRetry: vi.fn(),
  recordCancelRefund: vi.fn(),
  recordCharge: vi.fn(),
  recordPaymentCanceled: vi.fn(),
  recordTransfer: vi.fn(),
  recordUnbookedRefund: vi.fn(),
  refundsOwed: vi.fn(),
  refundsStuck: vi.fn(),
  transfersDue: vi.fn(),
  transfersWaiting: vi.fn(),
}));

const NOW = new Date('2026-11-12T12:00:00Z');
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const db = {} as Database;
const email = {
  transport: { send: () => Promise.resolve() },
  webUrl: 'http://localhost:3000',
  sendsPerSecond: 1,
};
const jobNamed = (name: string) => ({ id: '1', name }) as Job;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function logs() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger, asLogger: logger as unknown as Logger };
}

function paymentState(overrides: Partial<PaymentState> = {}): PaymentState {
  return {
    id: 'pi_1',
    clientSecret: 'pi_1_secret_x',
    status: 'succeeded',
    amountMinor: 400,
    receivedMinor: 400,
    refundedMinor: 0,
    chargeId: 'ch_1',
    currency: 'EUR',
    bookingId: 'b1',
    ...overrides,
  };
}

function gateway() {
  return {
    createPayoutAccount: vi.fn(),
    accountStatus: vi.fn(),
    onboardingLink: vi.fn(),
    dashboardLink: vi.fn(),
    createPayment: vi.fn(),
    payment: vi.fn<PaymentsGateway['payment']>(() => Promise.resolve(paymentState())),
    refundPayment: vi.fn<PaymentsGateway['refundPayment']>(() => Promise.resolve()),
    refundCancelled: vi.fn<PaymentsGateway['refundCancelled']>(() => Promise.resolve('re_new')),
    refund: vi.fn(),
    transfer: vi.fn<PaymentsGateway['transfer']>(() => Promise.resolve('tr_new')),
    refundMadeFor: vi.fn<PaymentsGateway['refundMadeFor']>(() => Promise.resolve(null)),
    transferMadeFor: vi.fn<PaymentsGateway['transferMadeFor']>(() => Promise.resolve(null)),
    cancelPayment: vi.fn<PaymentsGateway['cancelPayment']>(() =>
      Promise.resolve(paymentState({ status: 'canceled', receivedMinor: 0, chargeId: null })),
    ),
    parseEvent: vi.fn(),
  };
}

const cursor = (id: string) => ({ at: '2026-11-12 10:00:00.123456+00', id });

const owedRefund = (overrides: Partial<RefundOwed> = {}): RefundOwed => ({
  id: 'b1',
  paymentIntentId: 'pi_1',
  kind: 'cancelled',
  amountMinor: 200,
  updatedAt: ago(HOUR_MS),
  cursor: cursor(overrides.id ?? 'b1'),
  ...overrides,
});

const dueTransfer = (overrides: Partial<TransferDue> = {}): TransferDue => ({
  id: 'b1',
  paymentIntentId: 'pi_1',
  totalMinor: 400,
  refundMinor: 200,
  commissionBps: 1000,
  currency: 'EUR',
  chargeId: 'ch_1',
  accountId: 'acct_1',
  sending: null,
  cursor: cursor(overrides.id ?? 'b1'),
  ...overrides,
});

const lapsedPayment = (overrides: Partial<LapsedPayment> = {}): LapsedPayment => ({
  id: 'b1',
  paymentIntentId: 'pi_1',
  updatedAt: ago(2 * HOUR_MS),
  cursor: cursor(overrides.id ?? 'b1'),
  ...overrides,
});

describe('payments processor', () => {
  let stripe: ReturnType<typeof gateway>;
  let log: ReturnType<typeof logs>;
  const run = (name: string, extra: Partial<ProcessorContext> = {}) =>
    paymentsProcessor.process(jobNamed(name), {
      db,
      logger: log.asLogger,
      email,
      payments: stripe,
      ...extra,
    });

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    stripe = gateway();
    log = logs();
    for (const fn of [refundsOwed, transfersDue, lapsedPayments, ledgerMismatches]) {
      vi.mocked(fn).mockResolvedValue([] as never);
    }
    vi.mocked(markTransferSending).mockResolvedValue(true);
    vi.mocked(refundsStuck).mockResolvedValue(0);
    vi.mocked(transfersWaiting).mockResolvedValue({ bookings: 0, owners: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('runs one job at a time over every worker, each well inside its schedule', () => {
    expect(paymentsProcessor.queue).toBe(QUEUES.payments);
    expect(paymentsProcessor.globalConcurrency).toBe(1);
    expect(Object.fromEntries(paymentsProcessor.schedules.map((s) => [s.id, s.everyMs]))).toEqual({
      'send-refunds': 5 * MINUTE_MS,
      'send-transfers': 15 * MINUTE_MS,
      'cancel-lapsed-payments': 15 * MINUTE_MS,
      'check-money': 24 * HOUR_MS,
    });
  });

  it('refuses a job it doesn’t know, Stripe or not', async () => {
    await expect(run('send-everything')).rejects.toThrow(/Unknown payments job/);
    await expect(run('toString', { payments: null })).rejects.toThrow(/Unknown payments job/);
  });

  it('moves no money without Stripe: nothing was paid for', async () => {
    for (const name of ['send-refunds', 'send-transfers', 'cancel-lapsed-payments']) {
      await expect(run(name, { payments: null })).resolves.toEqual({ skipped: true });
    }
    expect(refundsOwed).not.toHaveBeenCalled();
    expect(transfersDue).not.toHaveBeenCalled();
    expect(lapsedPayments).not.toHaveBeenCalled();
  });

  describe('every sweep', () => {
    it('reads page after page from where the last ended, up to its most', async () => {
      vi.mocked(refundsOwed).mockImplementation((_db, _before, after) => {
        const n = after ? Number(after.id.slice(1)) : 0;
        return Promise.resolve([owedRefund({ id: `b${n + 1}` }), owedRefund({ id: `b${n + 2}` })]);
      });
      await expect(run('send-refunds')).resolves.toEqual({ done: 2 * MAX_PAGES, failed: 0 });
      expect(refundsOwed).toHaveBeenCalledTimes(MAX_PAGES);
      expect(refundsOwed).toHaveBeenNthCalledWith(2, db, expect.any(Date), cursor('b2'));
    });

    it('stops when its time is up, the rest for the next run', async () => {
      vi.mocked(refundsOwed).mockResolvedValueOnce([owedRefund({ id: 'b1' }), owedRefund()]);
      stripe.refundCancelled.mockImplementationOnce(() => {
        vi.setSystemTime(new Date(NOW.getTime() + 4 * MINUTE_MS));
        return Promise.resolve('re_new');
      });
      await expect(run('send-refunds')).resolves.toEqual({ done: 1, failed: 0 });
      expect(stripe.refundCancelled).toHaveBeenCalledOnce();
    });

    it('stops when the worker does', async () => {
      const stopping = new AbortController();
      vi.mocked(refundsOwed).mockResolvedValueOnce([owedRefund({ id: 'b1' }), owedRefund()]);
      stripe.refundCancelled.mockImplementationOnce(() => {
        stopping.abort();
        return Promise.resolve('re_new');
      });
      await expect(run('send-refunds', { signal: stopping.signal })).resolves.toEqual({
        done: 1,
        failed: 0,
      });
      expect(refundsOwed).toHaveBeenCalledOnce();
    });

    it('backs a refused row off, and stops when Stripe looks down', async () => {
      vi.mocked(refundsOwed).mockResolvedValueOnce(
        ['b1', 'b2', 'b3', 'b4'].map((id) => owedRefund({ id })),
      );
      stripe.refundCancelled.mockRejectedValue(new PaymentProviderError('StripeConnectionError'));
      await expect(run('send-refunds')).resolves.toEqual({
        done: 0,
        failed: OUTAGE_FAILURES,
      });
      expect(stripe.refundCancelled).toHaveBeenCalledTimes(OUTAGE_FAILURES);
      expect(noteMoneyRetry).toHaveBeenCalledWith(db, 'b1');
      expect(noteMoneyRetry).toHaveBeenCalledTimes(OUTAGE_FAILURES);
      expect(log.logger.warn).toHaveBeenLastCalledWith(
        { detail: 'StripeConnectionError' },
        'Stripe looks down: the rest waits for the next run',
      );
    });

    it('goes on past refusals that are the row’s own', async () => {
      vi.mocked(refundsOwed).mockResolvedValueOnce(
        ['b1', 'b2', 'b3', 'b4'].map((id) => owedRefund({ id })),
      );
      stripe.refundCancelled.mockRejectedValue(
        new PaymentProviderError('invalid_request_error charge_disputed'),
      );
      await expect(run('send-refunds')).resolves.toEqual({ done: 0, failed: 4 });
    });
  });

  describe('sending refunds', () => {
    it('leaves the API its own try first', async () => {
      await run('send-refunds');
      expect(refundsOwed).toHaveBeenCalledWith(db, ago(REFUND_GRACE_MS), undefined);
    });

    it('sends a cancellation’s refund for what its policy gives, the key enough inside a day', async () => {
      vi.mocked(refundsOwed).mockResolvedValueOnce([owedRefund()]);
      await expect(run('send-refunds')).resolves.toEqual({ done: 1, failed: 0 });
      expect(stripe.refundMadeFor).not.toHaveBeenCalled();
      expect(stripe.refundCancelled).toHaveBeenCalledWith({
        paymentIntentId: 'pi_1',
        bookingId: 'b1',
        amountMinor: 200,
      });
      expect(recordCancelRefund).toHaveBeenCalledWith(db, 'b1', 're_new');
    });

    it('past the key’s day, records a refund Stripe already made instead of making another', async () => {
      vi.mocked(refundsOwed).mockResolvedValueOnce([
        owedRefund({ updatedAt: ago(KEY_DAY_MS + MINUTE_MS) }),
      ]);
      stripe.refundMadeFor.mockResolvedValueOnce('re_old');
      await run('send-refunds');
      expect(stripe.refundMadeFor).toHaveBeenCalledWith('pi_1');
      expect(stripe.refundCancelled).not.toHaveBeenCalled();
      expect(recordCancelRefund).toHaveBeenCalledWith(db, 'b1', 're_old');
    });

    it('gives a paid hold all Stripe received back, unless Stripe already has', async () => {
      vi.mocked(refundsOwed).mockResolvedValueOnce([
        owedRefund({ kind: 'unbooked', amountMinor: 400 }),
      ]);
      // What Stripe took, not what the booking says, is what goes back and is entered.
      stripe.payment.mockResolvedValueOnce(paymentState({ receivedMinor: 350 }));
      await run('send-refunds');
      expect(stripe.refundPayment).toHaveBeenCalledWith('pi_1', 'not_bookable');
      expect(recordUnbookedRefund).toHaveBeenCalledWith(db, 'pi_1', 350);

      vi.mocked(refundsOwed).mockResolvedValueOnce([owedRefund({ kind: 'unbooked' })]);
      stripe.payment.mockResolvedValueOnce(paymentState({ refundedMinor: 400 }));
      await run('send-refunds');
      expect(stripe.refundPayment).toHaveBeenCalledOnce();
      expect(recordUnbookedRefund).toHaveBeenCalledTimes(2);
    });

    it('says which failed, telling support of one owed a day', async () => {
      vi.mocked(refundsOwed).mockResolvedValueOnce([
        owedRefund({ id: 'b1' }),
        owedRefund({ id: 'b2', updatedAt: ago(25 * HOUR_MS) }),
      ]);
      vi.mocked(refundsOwed).mockResolvedValueOnce([owedRefund({ id: 'b3' })]);
      stripe.refundCancelled.mockRejectedValueOnce(
        new PaymentProviderError('invalid_request_error charge_disputed'),
      );
      stripe.refundMadeFor.mockRejectedValueOnce(
        new PaymentProviderError('invalid_request_error charge_disputed'),
      );
      await expect(run('send-refunds')).resolves.toEqual({ done: 1, failed: 2 });
      expect(log.logger.warn).toHaveBeenCalledWith(
        { bookingId: 'b1', detail: 'invalid_request_error charge_disputed' },
        'refund not sent yet',
      );
      expect(log.logger.error).toHaveBeenCalledWith(
        { bookingId: 'b2', detail: 'invalid_request_error charge_disputed' },
        'refund owed for over a day',
      );
      expect(refundsOwed).toHaveBeenLastCalledWith(db, expect.any(Date), cursor('b2'));
      expect(recordCancelRefund).toHaveBeenCalledWith(db, 'b3', 're_new');
    });
  });

  describe('sending transfers', () => {
    it('works out 90% of what’s kept, keeps it, then sends it from the charge (#50, #51)', async () => {
      vi.mocked(transfersDue).mockResolvedValueOnce([dueTransfer()]);
      await expect(run('send-transfers')).resolves.toEqual({ done: 1, failed: 0 });
      expect(transfersDue).toHaveBeenCalledWith(db, NOW, undefined);
      expect(markTransferSending).toHaveBeenCalledWith(db, 'b1', {
        transferMinor: 180,
        commissionMinor: 20,
      });
      expect(stripe.transfer).toHaveBeenCalledWith({
        bookingId: 'b1',
        accountId: 'acct_1',
        amountMinor: 180,
        currency: 'EUR',
        chargeId: 'ch_1',
      });
      expect(recordTransfer).toHaveBeenCalledWith(db, 'b1', 'tr_new');
      // The sums were kept before Stripe was asked.
      expect(vi.mocked(markTransferSending).mock.invocationCallOrder[0]).toBeLessThan(
        stripe.transfer.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('sends nothing for a booking no longer due as it was read', async () => {
      vi.mocked(transfersDue).mockResolvedValueOnce([dueTransfer()]);
      vi.mocked(markTransferSending).mockResolvedValueOnce(false);
      await expect(run('send-transfers')).resolves.toEqual({ done: 0, failed: 0 });
      expect(stripe.transfer).not.toHaveBeenCalled();
    });

    it('sends again what a try before worked out, asking first only past the key’s day', async () => {
      const sending = { transferMinor: 1800, commissionMinor: 200, since: ago(HOUR_MS) };
      vi.mocked(transfersDue).mockResolvedValueOnce([dueTransfer({ sending })]);
      await run('send-transfers');
      expect(markTransferSending).not.toHaveBeenCalled();
      expect(stripe.transferMadeFor).not.toHaveBeenCalled();
      expect(stripe.transfer).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 1800 }));

      const old = { ...sending, since: ago(KEY_DAY_MS + MINUTE_MS) };
      vi.mocked(transfersDue).mockResolvedValueOnce([dueTransfer({ sending: old })]);
      stripe.transferMadeFor.mockResolvedValueOnce('tr_old');
      await run('send-transfers');
      expect(stripe.transferMadeFor).toHaveBeenCalledWith('b1');
      expect(stripe.transfer).toHaveBeenCalledOnce();
      expect(recordTransfer).toHaveBeenLastCalledWith(db, 'b1', 'tr_old');
    });

    it('asks Stripe for a charge it didn’t have when the payment settled', async () => {
      vi.mocked(transfersDue).mockResolvedValueOnce([dueTransfer({ chargeId: null })]);
      stripe.payment.mockResolvedValueOnce(paymentState({ chargeId: 'ch_late' }));
      await run('send-transfers');
      expect(recordCharge).toHaveBeenCalledWith(db, 'b1', {
        amountMinor: 400,
        chargeId: 'ch_late',
      });
      expect(stripe.transfer).toHaveBeenCalledWith(
        expect.objectContaining({ chargeId: 'ch_late' }),
      );
    });

    it('sends nothing without a charge to take it from, and says so', async () => {
      vi.mocked(transfersDue).mockResolvedValueOnce([
        dueTransfer({ id: 'b1', chargeId: null }),
        dueTransfer({ id: 'b2', chargeId: null, paymentIntentId: null }),
      ]);
      stripe.payment.mockResolvedValueOnce(paymentState({ chargeId: null }));
      await expect(run('send-transfers')).resolves.toEqual({ done: 0, failed: 2 });
      expect(log.logger.warn).toHaveBeenCalledWith(
        { bookingId: 'b1', detail: 'no charge' },
        'transfer not sent yet',
      );
      expect(log.logger.warn).toHaveBeenCalledWith(
        { bookingId: 'b2', detail: 'Error' },
        'transfer not sent yet',
      );
      expect(markTransferSending).not.toHaveBeenCalled();
      expect(stripe.transfer).not.toHaveBeenCalled();
    });

    it('sends nothing where the owner would get nothing, says so, and asks again later', async () => {
      vi.mocked(transfersDue).mockResolvedValueOnce([dueTransfer({ commissionBps: 10_000 })]);
      await expect(run('send-transfers')).resolves.toEqual({ done: 0, failed: 0 });
      expect(stripe.transfer).not.toHaveBeenCalled();
      expect(noteMoneyRetry).toHaveBeenCalledWith(db, 'b1');
      expect(log.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId: 'b1', ownerMinor: 0 }),
        'nothing to transfer to the owner',
      );
    });

    it('leaves a failed transfer for later, the rest going on', async () => {
      vi.mocked(transfersDue).mockResolvedValueOnce([
        dueTransfer({ id: 'b1' }),
        dueTransfer({ id: 'b2' }),
      ]);
      stripe.transfer.mockRejectedValueOnce(
        new PaymentProviderError('invalid_request_error insufficient_capabilities_for_transfer'),
      );
      await expect(run('send-transfers')).resolves.toEqual({ done: 1, failed: 1 });
      expect(log.logger.warn).toHaveBeenCalledWith(
        { bookingId: 'b1', detail: 'invalid_request_error insufficient_capabilities_for_transfer' },
        'transfer not sent yet',
      );
      expect(noteMoneyRetry).toHaveBeenCalledWith(db, 'b1');
      expect(recordTransfer).toHaveBeenCalledWith(db, 'b2', 'tr_new');
    });
  });

  describe('calling off lapsed payments', () => {
    it('leaves a late payment its hour (#3), then calls it off and records it', async () => {
      vi.mocked(lapsedPayments).mockResolvedValueOnce([lapsedPayment()]);
      await expect(run('cancel-lapsed-payments')).resolves.toEqual({ done: 1, failed: 0 });
      expect(lapsedPayments).toHaveBeenCalledWith(db, ago(LAPSED_PAYMENT_MS), undefined);
      expect(stripe.cancelPayment).toHaveBeenCalledWith('pi_1');
      expect(recordPaymentCanceled).toHaveBeenCalledWith(db, 'b1');
    });

    it('leaves one paid meanwhile to its webhook, less often, telling support after a day', async () => {
      vi.mocked(lapsedPayments).mockResolvedValueOnce([
        lapsedPayment({ id: 'b1' }),
        lapsedPayment({ id: 'b2', updatedAt: ago(25 * HOUR_MS) }),
      ]);
      stripe.cancelPayment.mockResolvedValue(paymentState({ status: 'succeeded' }));
      await expect(run('cancel-lapsed-payments')).resolves.toEqual({ done: 0, failed: 0 });
      expect(recordPaymentCanceled).not.toHaveBeenCalled();
      expect(noteMoneyRetry).toHaveBeenCalledTimes(2);
      expect(log.logger.info).toHaveBeenCalledWith(
        { bookingId: 'b1', status: 'succeeded' },
        'lapsed hold paid meanwhile',
      );
      expect(log.logger.error).toHaveBeenCalledWith(
        { bookingId: 'b2', status: 'succeeded' },
        'lapsed hold paid, unsettled for a day',
      );
    });

    it('tries a failed one again later', async () => {
      vi.mocked(lapsedPayments).mockResolvedValueOnce([lapsedPayment()]);
      stripe.cancelPayment.mockRejectedValueOnce(new PaymentProviderError('api_error'));
      await expect(run('cancel-lapsed-payments')).resolves.toEqual({ done: 0, failed: 1 });
      expect(log.logger.warn).toHaveBeenCalledWith(
        { bookingId: 'b1', detail: 'api_error' },
        'lapsed payment not called off yet',
      );
      expect(noteMoneyRetry).toHaveBeenCalledWith(db, 'b1');
    });
  });

  describe('the day’s check', () => {
    it('looks at what was entered since the run before, and says nothing when all is well', async () => {
      await expect(run('check-money')).resolves.toEqual({ mismatched: 0, stuck: 0, waiting: 0 });
      expect(ledgerMismatches).toHaveBeenCalledWith(db, ago(48 * HOUR_MS));
      expect(refundsStuck).toHaveBeenCalledWith(db, ago(24 * HOUR_MS));
      expect(transfersWaiting).toHaveBeenCalledWith(
        db,
        ago(TRANSFER_WAIT_ALERT_DAYS * 24 * HOUR_MS),
      );
      expect(log.logger.error).not.toHaveBeenCalled();
    });

    it('tells support what’s wrong, with Stripe or without (#52)', async () => {
      vi.mocked(ledgerMismatches).mockResolvedValueOnce(['b1']);
      vi.mocked(refundsStuck).mockResolvedValueOnce(2);
      vi.mocked(transfersWaiting).mockResolvedValueOnce({ bookings: 3, owners: 2 });
      await expect(run('check-money', { payments: null })).resolves.toEqual({
        mismatched: 1,
        stuck: 2,
        waiting: 3,
      });
      expect(log.logger.error).toHaveBeenCalledWith(
        { bookingIds: ['b1'] },
        'ledger does not add up',
      );
      expect(log.logger.error).toHaveBeenCalledWith({ refunds: 2 }, 'refunds owed for over a day');
      expect(log.logger.error).toHaveBeenCalledWith(
        { bookings: 3, owners: 2 },
        `transfers waiting over ${TRANSFER_WAIT_ALERT_DAYS} days`,
      );
    });
  });
});
