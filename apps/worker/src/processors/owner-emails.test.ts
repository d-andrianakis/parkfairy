import {
  claimDueEmails,
  countOverdueEmails,
  enqueueListingStatusEmails,
  enqueueOnboardingReminders,
  markEmailFailed,
  markEmailSent,
  purgeSentEmails,
  releaseEmails,
  type ClaimedEmail,
  type Database,
} from '@parkfairy/database';
import { resendTransport, SendStopped, type EmailTransport } from '@parkfairy/email';
import type { Job } from 'bullmq';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUES } from '../queues.js';
import {
  ownerEmailsProcessor,
  REMINDER_AFTER_DAYS,
  SEND_BATCH,
  SEND_RUN_MS,
} from './owner-emails.js';

vi.mock('@parkfairy/database', () => ({
  claimDueEmails: vi.fn(),
  countOverdueEmails: vi.fn(),
  enqueueListingStatusEmails: vi.fn(),
  enqueueOnboardingReminders: vi.fn(),
  markEmailFailed: vi.fn(),
  markEmailSent: vi.fn(),
  purgeSentEmails: vi.fn(),
  releaseEmails: vi.fn(),
}));

const db = {} as Database;
const logger = pino({ level: 'silent' });
const send = vi.fn<EmailTransport['send']>();
const context = (sendsPerSecond = 1, signal?: AbortSignal) => ({
  db,
  logger,
  email: { transport: { send }, webUrl: 'https://parkfairy.example', sendsPerSecond },
  signal,
});
const run = (name: string, sendsPerSecond?: number, signal?: AbortSignal) =>
  ownerEmailsProcessor.process({ id: '1', name } as Job, context(sendsPerSecond, signal));

const row = (overrides: Partial<ClaimedEmail> = {}): ClaimedEmail => ({
  id: 'email-1',
  kind: 'listing-approved',
  attempts: 1,
  payload: { listingName: 'Γκαράζ' },
  to: 'owner@example.gr',
  locale: 'el',
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(countOverdueEmails).mockResolvedValue(0);
  send.mockResolvedValue();
});

describe('owner emails processor', () => {
  it('runs on its own queue, with a schedule for each job', () => {
    expect(ownerEmailsProcessor.queue).toBe(QUEUES.email);
    // One job at a time over every worker process: two senders would pass Resend's limit.
    expect(ownerEmailsProcessor.globalConcurrency).toBe(1);
    expect(ownerEmailsProcessor.schedules.map((s) => s.id).sort()).toEqual([
      'enqueue-listing-status-emails',
      'enqueue-onboarding-reminders',
      'purge-sent-emails',
      'send-owner-emails',
    ]);
  });

  it('queues status emails', async () => {
    vi.mocked(enqueueListingStatusEmails).mockResolvedValue(2);
    await expect(run('enqueue-listing-status-emails')).resolves.toEqual({ queued: 2 });
  });

  it('asks for reminders only after the owner has been quiet long enough', async () => {
    vi.useFakeTimers({ now: new Date('2027-06-10T12:00:00Z') });
    vi.mocked(enqueueOnboardingReminders).mockResolvedValue(1);
    await run('enqueue-onboarding-reminders');
    expect(enqueueOnboardingReminders).toHaveBeenCalledWith(
      db,
      new Date(Date.UTC(2027, 5, 10 - REMINDER_AFTER_DAYS, 12)),
    );
    vi.useRealTimers();
  });

  it('sends each due email with its outbox id as the idempotency key', async () => {
    vi.mocked(claimDueEmails).mockResolvedValue([row()]);
    await expect(run('send-owner-emails')).resolves.toEqual({ sent: 1, failed: 0, handedBack: 0 });

    const email = send.mock.calls[0]?.[0];
    expect(email?.to).toBe('owner@example.gr');
    expect(email?.idempotencyKey).toBe('email-1');
    expect(email?.text).toContain('Γκαράζ');
    expect(email?.text).toContain('https://parkfairy.example/el/owner');
    expect(markEmailSent).toHaveBeenCalledWith(db, 'email-1');
  });

  it('goes on claiming in a rush, until a claim comes back short', async () => {
    const batch = (from: number, count: number) =>
      Array.from({ length: count }, (_, n) => row({ id: `email-${from + n}` }));
    vi.mocked(claimDueEmails)
      .mockResolvedValueOnce(batch(0, SEND_BATCH))
      .mockResolvedValueOnce(batch(SEND_BATCH, SEND_BATCH))
      .mockResolvedValueOnce(batch(2 * SEND_BATCH, 3));
    await expect(run('send-owner-emails')).resolves.toEqual({
      sent: 2 * SEND_BATCH + 3,
      failed: 0,
      handedBack: 0,
    });
    expect(claimDueEmails).toHaveBeenCalledTimes(3);
    expect(countOverdueEmails).toHaveBeenCalledOnce();
  });

  it.each([
    [1, [20, 5]],
    [4, [20, 20, 20, 20, 20]],
    [0.5, [12]],
  ])(
    'claims only what its pace sends before the next run is due (%s a second)',
    async (pace, sizes) => {
      vi.useFakeTimers({ now: new Date('2027-06-10T12:00:00Z') });
      const started = Date.now();
      // A backlog: every claim comes back as full as asked.
      vi.mocked(claimDueEmails).mockImplementation((_db, limit) =>
        Promise.resolve(Array.from({ length: limit }, (_, n) => row({ id: `email-${n}` }))),
      );
      // Each send takes what the transport's pace makes it.
      send.mockImplementation(() => {
        vi.setSystemTime(Date.now() + 1_000 / pace);
        return Promise.resolve();
      });
      const result = await run('send-owner-emails', pace);
      expect(vi.mocked(claimDueEmails).mock.calls.map(([, limit]) => limit)).toEqual(sizes);
      expect(result).toEqual({ sent: sizes.reduce((a, b) => a + b), failed: 0, handedBack: 0 });
      expect(Date.now() - started).toBeLessThanOrEqual(SEND_RUN_MS);
    },
  );

  describe('when its time is up', () => {
    const backlog = () =>
      vi
        .mocked(claimDueEmails)
        .mockImplementation((_db, limit) =>
          Promise.resolve(Array.from({ length: limit }, (_, n) => row({ id: `email-${n}` }))),
        );
    const handedBackIds = () =>
      vi.mocked(releaseEmails).mock.calls.flatMap(([, rows]) => rows.map(({ id }) => id));

    // In production BullMQ always hands the job a signal, so the deadline is one of two.
    describe.each([
      ['alone', () => undefined],
      ['beside a worker’s signal', () => new AbortController().signal],
    ])('with the deadline %s', (_how, live: () => AbortSignal | undefined) => {
      it('hands back what a slow Resend left unsent, with nothing counted as failed', async () => {
        vi.useFakeTimers({ now: new Date('2027-06-10T12:00:00Z') });
        const started = Date.now();
        backlog();
        // Three seconds a send instead of one: the claim of 20 would take a minute.
        send.mockImplementation(() => {
          vi.setSystemTime(Date.now() + 3_000);
          return Promise.resolve();
        });
        await expect(run('send-owner-emails', 1, live())).resolves.toEqual({
          sent: 9,
          failed: 0,
          handedBack: 11,
        });
        expect(claimDueEmails).toHaveBeenCalledOnce();
        expect(handedBackIds()).toEqual(Array.from({ length: 11 }, (_, n) => `email-${n + 9}`));
        expect(markEmailFailed).not.toHaveBeenCalled();
        // The last send began before the deadline; none began after it.
        expect(Date.now() - started).toBeLessThan(SEND_RUN_MS + 3_000);
      });

      it('stops a send still going at the deadline, and hands it back with the rest', async () => {
        vi.useFakeTimers({ now: new Date('2027-06-10T12:00:00Z') });
        backlog();
        // The second send never answers by itself (Resend doesn't answer before the deadline).
        send.mockResolvedValueOnce().mockImplementation(
          (_email, options) =>
            new Promise((_resolve, reject) => {
              options?.signal?.addEventListener('abort', () => reject(new SendStopped(undefined)));
            }),
        );
        const result = run('send-owner-emails', 1, live());
        await vi.advanceTimersByTimeAsync(SEND_RUN_MS);
        await expect(result).resolves.toEqual({ sent: 1, failed: 0, handedBack: 19 });
        expect(handedBackIds()[0]).toBe('email-1');
        expect(markEmailFailed).not.toHaveBeenCalled();
        expect(claimDueEmails).toHaveBeenCalledOnce();
        // Nothing is left waiting on the run.
        expect(vi.getTimerCount()).toBe(0);
      });

      it('counts a send stopped while waiting out a refusal as failed, with Resend’s reason', async () => {
        vi.useFakeTimers({ now: new Date('2027-06-10T12:00:00Z') });
        backlog();
        // A quota spent for the day: 429 with a Retry-After past the deadline.
        send.mockImplementation(
          (_email, options) =>
            new Promise((_resolve, reject) => {
              options?.signal?.addEventListener('abort', () =>
                reject(new SendStopped('Resend answered 429 daily_quota_exceeded')),
              );
            }),
        );
        const result = run('send-owner-emails', 1, live());
        await vi.advanceTimersByTimeAsync(SEND_RUN_MS);
        await expect(result).resolves.toEqual({ sent: 0, failed: 1, handedBack: SEND_BATCH - 1 });
        // Its try spent and its reason kept, so the wait between tries and the last try apply.
        expect(markEmailFailed).toHaveBeenCalledWith(
          db,
          expect.objectContaining({ id: 'email-0' }),
          'Resend answered 429 daily_quota_exceeded',
        );
        expect(handedBackIds()).toEqual(
          Array.from({ length: SEND_BATCH - 1 }, (_, n) => `email-${n + 1}`),
        );
      });

      it('counts a real failure as one, even when it lands as time runs out', async () => {
        vi.useFakeTimers({ now: new Date('2027-06-10T12:00:00Z') });
        backlog();
        send.mockImplementationOnce(() => {
          // Refused for good on the last try, just as the deadline aborts the run.
          vi.advanceTimersByTime(SEND_RUN_MS);
          return Promise.reject(new Error('Resend answered 422 validation_error'));
        });
        await expect(run('send-owner-emails', 1, live())).resolves.toEqual({
          sent: 0,
          failed: 1,
          handedBack: SEND_BATCH - 1,
        });
        expect(markEmailFailed).toHaveBeenCalledOnce();
        expect(handedBackIds()[0]).toBe('email-1');
      });
    });

    it('stops at once when the worker shuts down, handing back the claim’s rest', async () => {
      backlog();
      const shutdown = new AbortController();
      send.mockImplementation(() => {
        // SIGTERM while the third email is sent: it goes out, the rest wait.
        if (send.mock.calls.length === 3) shutdown.abort('shutting down');
        return Promise.resolve();
      });
      await expect(run('send-owner-emails', 1, shutdown.signal)).resolves.toEqual({
        sent: 3,
        failed: 0,
        handedBack: SEND_BATCH - 3,
      });
      expect(handedBackIds()).toHaveLength(SEND_BATCH - 3);
      expect(claimDueEmails).toHaveBeenCalledOnce();
    });

    it('hands back the whole claim when the worker stops while it is being claimed', async () => {
      const shutdown = new AbortController();
      vi.mocked(claimDueEmails).mockImplementation((_db, limit) => {
        // SIGTERM lands during the claim's round trip.
        shutdown.abort('shutting down');
        return Promise.resolve(Array.from({ length: limit }, (_, n) => row({ id: `email-${n}` })));
      });
      await expect(run('send-owner-emails', 1, shutdown.signal)).resolves.toEqual({
        sent: 0,
        failed: 0,
        handedBack: SEND_BATCH,
      });
      expect(send).not.toHaveBeenCalled();
      expect(handedBackIds()).toEqual(Array.from({ length: SEND_BATCH }, (_, n) => `email-${n}`));
    });

    it('stops the real transport’s request at the deadline, and hands the email back', async () => {
      vi.useFakeTimers({ now: new Date('2027-06-10T12:00:00Z') });
      backlog();
      // Across the package boundary: Resend's transport, its request never answered.
      const fetchFn = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
          }),
      );
      const transport = resendTransport({
        apiKey: 're_k',
        from: 'P <a@b.gr>',
        fetchFn,
        timeoutMs: 60_000,
      });
      const result = ownerEmailsProcessor.process({ id: '1', name: 'send-owner-emails' } as Job, {
        ...context(1, new AbortController().signal),
        email: { transport, webUrl: 'https://parkfairy.example', sendsPerSecond: 1 },
      });
      await vi.advanceTimersByTimeAsync(SEND_RUN_MS);
      await expect(result).resolves.toEqual({ sent: 0, failed: 0, handedBack: SEND_BATCH });
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(markEmailFailed).not.toHaveBeenCalled();
    });

    it('claims nothing once the worker is shutting down', async () => {
      backlog();
      await expect(
        run('send-owner-emails', 1, AbortSignal.abort('shutting down')),
      ).resolves.toEqual({ sent: 0, failed: 0, handedBack: 0 });
      expect(claimDueEmails).not.toHaveBeenCalled();
      expect(releaseEmails).not.toHaveBeenCalled();
    });

    it('says in the logs when the deadline, not a shutdown, stopped it', async () => {
      vi.useFakeTimers({ now: new Date('2027-06-10T12:00:00Z') });
      const lines: string[] = [];
      const loud = pino({ level: 'info' }, { write: (line: string) => void lines.push(line) });
      backlog();
      send.mockImplementation(() => {
        vi.setSystemTime(Date.now() + SEND_RUN_MS);
        return Promise.resolve();
      });
      await ownerEmailsProcessor.process({ id: '1', name: 'send-owner-emails' } as Job, {
        ...context(1, new AbortController().signal),
        logger: loud,
      });
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
        msg: 'unsent emails handed back for the next run',
        handedBack: SEND_BATCH - 1,
        shuttingDown: false,
      });
    });

    it('says so in the logs, without addresses', async () => {
      const lines: string[] = [];
      const loud = pino({ level: 'info' }, { write: (line: string) => void lines.push(line) });
      backlog();
      const shutdown = new AbortController();
      send.mockImplementation(() => {
        shutdown.abort('shutting down');
        return Promise.resolve();
      });
      await ownerEmailsProcessor.process({ id: '1', name: 'send-owner-emails' } as Job, {
        ...context(1, shutdown.signal),
        logger: loud,
      });
      const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
      expect(entry).toMatchObject({
        level: 40,
        msg: 'unsent emails handed back for the next run',
        handedBack: SEND_BATCH - 1,
        shuttingDown: true,
      });
      expect(lines.join('')).not.toContain('owner@example.gr');
    });
  });

  it('counts failures across claims', async () => {
    const batch = (from: number, count: number) =>
      Array.from({ length: count }, (_, n) => row({ id: `email-${from + n}` }));
    vi.mocked(claimDueEmails)
      .mockResolvedValueOnce(batch(0, SEND_BATCH))
      .mockResolvedValueOnce(batch(SEND_BATCH, 3));
    send.mockRejectedValueOnce(new Error('Resend answered 500'));
    await expect(run('send-owner-emails')).resolves.toEqual({
      sent: SEND_BATCH + 2,
      failed: 1,
      handedBack: 0,
    });
  });

  it('stops when a whole claim fails, so an outage spends one try of a claim, not of the backlog', async () => {
    vi.mocked(claimDueEmails).mockImplementation((_db, limit) =>
      Promise.resolve(Array.from({ length: limit }, (_, n) => row({ id: `email-${n}` }))),
    );
    send.mockRejectedValue(new Error('Resend answered 503'));
    await expect(run('send-owner-emails')).resolves.toEqual({
      sent: 0,
      failed: SEND_BATCH,
      handedBack: 0,
    });
    expect(claimDueEmails).toHaveBeenCalledOnce();
    expect(markEmailFailed).toHaveBeenCalledTimes(SEND_BATCH);
  });

  it('reads a listing’s name in the language it is written in', async () => {
    vi.mocked(claimDueEmails).mockResolvedValue([
      row({ payload: { listingName: 'Seaside Garage', contentLocale: 'en' } }),
    ]);
    await run('send-owner-emails');
    expect(send.mock.calls[0]?.[0].html).toContain('«<span lang="en">Seaside Garage</span>»');
  });

  it('writes in the language on the account', async () => {
    vi.mocked(claimDueEmails).mockResolvedValue([row({ locale: 'en' })]);
    await run('send-owner-emails');
    expect(send.mock.calls[0]?.[0].subject).toBe('Your listing is live');
  });

  it('keeps going past a failure and marks it for another try', async () => {
    vi.mocked(claimDueEmails).mockResolvedValue([row(), row({ id: 'email-2' })]);
    send.mockRejectedValueOnce(new Error('Resend answered 500'));

    await expect(run('send-owner-emails')).resolves.toEqual({ sent: 1, failed: 1, handedBack: 0 });
    expect(markEmailFailed).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ id: 'email-1' }),
      'Resend answered 500',
    );
    expect(markEmailSent).toHaveBeenCalledOnce();
  });

  it('sends booking emails with the booking set out, to the page they are about', async () => {
    const booking = {
      id: 'b0b0b0b0-0000-4000-8000-000000000001',
      listingId: 'l0l0l0l0-0000-4000-8000-000000000001',
      reference: 'K7M4-Q2ZD',
      address: 'Ερμού 1',
      contentLocale: 'el',
      spaceLabel: 'A1',
      start: '2026-12-10T08:00:00.000Z',
      end: '2026-12-10T10:00:00.000Z',
      timeZone: 'Europe/Athens',
      totalMinor: 400,
      currency: 'EUR',
    };
    vi.mocked(claimDueEmails).mockResolvedValue([
      row({ kind: 'booking-confirmed', locale: 'en', payload: { listingName: 'Γκαράζ', booking } }),
      row({ id: 'email-2', kind: 'booking-received', payload: { listingName: 'Γκαράζ', booking } }),
    ]);
    await expect(run('send-owner-emails')).resolves.toEqual({ sent: 2, failed: 0, handedBack: 0 });
    const [driver, owner] = send.mock.calls.map(([email]) => email);
    expect(driver?.subject).toBe('Your parking is booked (K7M4-Q2ZD)');
    expect(driver?.text).toContain(`https://parkfairy.example/en/bookings/${booking.id}`);
    expect(owner?.text).toContain(
      `https://parkfairy.example/el/owner/listings/${booking.listingId}/bookings`,
    );
    expect(owner?.idempotencyKey).toBe('email-2');
  });

  it('refuses a booking email that lost its booking, without losing the rest', async () => {
    vi.mocked(claimDueEmails).mockResolvedValue([
      row({ kind: 'booking-confirmed', payload: {} }),
      row({ id: 'email-2' }),
    ]);
    await expect(run('send-owner-emails')).resolves.toEqual({ sent: 1, failed: 1, handedBack: 0 });
    expect(markEmailFailed).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ id: 'email-1' }),
      'Email "booking-confirmed" has no booking',
    );
  });

  it('refuses a kind it has no template for, without losing the rest', async () => {
    const unknown = row({ kind: 'nonsense' as ClaimedEmail['kind'] });
    vi.mocked(claimDueEmails).mockResolvedValue([unknown, row({ id: 'email-2' })]);
    await expect(run('send-owner-emails')).resolves.toEqual({ sent: 1, failed: 1, handedBack: 0 });
    expect(send).toHaveBeenCalledOnce();
  });

  it('raises its voice when an email is given up on, and never logs the address', async () => {
    const lines: string[] = [];
    const loud = pino({ level: 'info' }, { write: (line: string) => void lines.push(line) });
    vi.mocked(claimDueEmails).mockResolvedValue([row()]);
    vi.mocked(markEmailFailed).mockResolvedValue(true);
    send.mockRejectedValueOnce(new Error('Resend answered 500'));

    await ownerEmailsProcessor.process({ id: '1', name: 'send-owner-emails' } as Job, {
      ...context(),
      logger: loud,
    });

    const entry = JSON.parse(lines[0] ?? '{}') as { level: number; msg: string };
    expect(entry.level).toBe(50); // error
    expect(entry.msg).toBe('owner email given up on');
    expect(lines.join('')).not.toContain('owner@example.gr');
  });

  it('logs an error when emails are overdue', async () => {
    const lines: string[] = [];
    const loud = pino({ level: 'info' }, { write: (line: string) => void lines.push(line) });
    vi.mocked(claimDueEmails).mockResolvedValue([]);
    vi.mocked(countOverdueEmails).mockResolvedValue(3);
    await ownerEmailsProcessor.process({ id: '1', name: 'send-owner-emails' } as Job, {
      ...context(),
      logger: loud,
    });
    expect(lines.join('')).toContain('waiting for over a day');
  });

  it('purges sent emails past the retention period', async () => {
    vi.useFakeTimers({ now: new Date('2027-06-10T12:00:00Z') });
    vi.mocked(purgeSentEmails).mockResolvedValue(4);
    await expect(run('purge-sent-emails')).resolves.toEqual({ purged: 4 });
    expect(purgeSentEmails).toHaveBeenCalledWith(db, new Date('2027-03-12T12:00:00Z'));
    vi.useRealTimers();
  });

  it('fails loudly on an unknown job', async () => {
    await expect(run('nope')).rejects.toThrow('Unknown email job "nope"');
  });
});
