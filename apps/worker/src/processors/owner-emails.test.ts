import {
  claimDueEmails,
  countOverdueEmails,
  enqueueListingStatusEmails,
  enqueueOnboardingReminders,
  markEmailFailed,
  markEmailSent,
  purgeSentEmails,
  type ClaimedEmail,
  type Database,
} from '@parkfairy/database';
import type { EmailTransport } from '@parkfairy/email';
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
}));

const db = {} as Database;
const logger = pino({ level: 'silent' });
const send = vi.fn<EmailTransport['send']>();
const context = (sendsPerSecond = 1) => ({
  db,
  logger,
  email: { transport: { send }, webUrl: 'https://parkfairy.example', sendsPerSecond },
});
const run = (name: string, sendsPerSecond?: number) =>
  ownerEmailsProcessor.process({ id: '1', name } as Job, context(sendsPerSecond));

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
    await expect(run('send-owner-emails')).resolves.toEqual({ sent: 1, failed: 0 });

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
      expect(result).toEqual({ sent: sizes.reduce((a, b) => a + b), failed: 0 });
      expect(Date.now() - started).toBeLessThanOrEqual(SEND_RUN_MS);
    },
  );

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
    });
  });

  it('stops when a whole claim fails, so an outage spends one try of a claim, not of the backlog', async () => {
    vi.mocked(claimDueEmails).mockImplementation((_db, limit) =>
      Promise.resolve(Array.from({ length: limit }, (_, n) => row({ id: `email-${n}` }))),
    );
    send.mockRejectedValue(new Error('Resend answered 503'));
    await expect(run('send-owner-emails')).resolves.toEqual({ sent: 0, failed: SEND_BATCH });
    expect(claimDueEmails).toHaveBeenCalledOnce();
    expect(markEmailFailed).toHaveBeenCalledTimes(SEND_BATCH);
  });

  it('writes in the language on the account', async () => {
    vi.mocked(claimDueEmails).mockResolvedValue([row({ locale: 'en' })]);
    await run('send-owner-emails');
    expect(send.mock.calls[0]?.[0].subject).toBe('Your listing is live');
  });

  it('keeps going past a failure and marks it for another try', async () => {
    vi.mocked(claimDueEmails).mockResolvedValue([row(), row({ id: 'email-2' })]);
    send.mockRejectedValueOnce(new Error('Resend answered 500'));

    await expect(run('send-owner-emails')).resolves.toEqual({ sent: 1, failed: 1 });
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
    await expect(run('send-owner-emails')).resolves.toEqual({ sent: 2, failed: 0 });
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
    await expect(run('send-owner-emails')).resolves.toEqual({ sent: 1, failed: 1 });
    expect(markEmailFailed).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ id: 'email-1' }),
      'Email "booking-confirmed" has no booking',
    );
  });

  it('refuses a kind it has no template for, without losing the rest', async () => {
    const unknown = row({ kind: 'nonsense' as ClaimedEmail['kind'] });
    vi.mocked(claimDueEmails).mockResolvedValue([unknown, row({ id: 'email-2' })]);
    await expect(run('send-owner-emails')).resolves.toEqual({ sent: 1, failed: 1 });
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
