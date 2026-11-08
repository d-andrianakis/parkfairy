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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUES } from '../queues.js';
import { ownerEmailsProcessor, REMINDER_AFTER_DAYS } from './owner-emails.js';

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
const context = () => ({
  db,
  logger,
  email: { transport: { send }, webUrl: 'https://parkfairy.example' },
});
const run = (name: string) => ownerEmailsProcessor.process({ id: '1', name } as Job, context());

const row = (overrides: Partial<ClaimedEmail> = {}): ClaimedEmail => ({
  id: 'email-1',
  kind: 'listing-approved',
  attempts: 1,
  payload: { listingName: 'Γκαράζ' },
  to: 'owner@example.gr',
  locale: 'el',
  ...overrides,
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
