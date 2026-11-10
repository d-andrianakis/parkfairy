import {
  deleteEndedHoursExceptions,
  deleteStaleHolds,
  deleteUnconfirmedAccounts,
  expireLapsedHolds,
  type Database,
} from '@parkfairy/database';
import type { Job } from 'bullmq';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUEUES } from '../queues.js';
import { maintenanceProcessor, STALE_HOLD_DAYS, UNCONFIRMED_ACCOUNT_DAYS } from './maintenance.js';

vi.mock('@parkfairy/database', () => ({
  deleteEndedHoursExceptions: vi.fn(),
  deleteUnconfirmedAccounts: vi.fn(),
  expireLapsedHolds: vi.fn(),
  deleteStaleHolds: vi.fn(),
}));

const logger = pino({ level: 'silent' });
const email = {
  transport: { send: () => Promise.resolve() },
  webUrl: 'http://localhost:3000',
  sendsPerSecond: 1,
};
const jobNamed = (name: string) => ({ id: '1', name }) as Job;

describe('maintenance processor', () => {
  it('runs on the maintenance queue with a recurring heartbeat schedule', () => {
    expect(maintenanceProcessor.queue).toBe(QUEUES.maintenance);
    expect(maintenanceProcessor.schedules).toContainEqual({ id: 'heartbeat', everyMs: 60_000 });
  });

  it('heartbeat round-trips to the database', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const db = { execute } as unknown as Database;

    await expect(
      maintenanceProcessor.process(jobNamed('heartbeat'), { db, logger, email }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  describe('deleting unconfirmed accounts', () => {
    const remove = vi.mocked(deleteUnconfirmedAccounts);
    afterEach(() => {
      vi.useRealTimers();
    });

    it('runs several times a day', () => {
      expect(maintenanceProcessor.schedules).toContainEqual({
        id: 'delete-unconfirmed-accounts',
        everyMs: 6 * 60 * 60 * 1000,
      });
    });

    it('removes accounts older than the grace period, and reports how many', async () => {
      vi.useFakeTimers({ now: new Date('2026-10-30T12:00:00Z'), toFake: ['Date'] });
      remove.mockResolvedValue(3);
      const db = {} as Database;

      await expect(
        maintenanceProcessor.process(jobNamed('delete-unconfirmed-accounts'), {
          db,
          logger,
          email,
        }),
      ).resolves.toEqual({ deleted: 3 });

      expect(UNCONFIRMED_ACCOUNT_DAYS).toBeGreaterThan(1); // the emailed link lasts a day
      expect(remove).toHaveBeenCalledWith(db, new Date('2026-10-23T12:00:00Z'));
    });
  });

  describe('deleting ended closures and special hours', () => {
    const remove = vi.mocked(deleteEndedHoursExceptions);
    afterEach(() => {
      vi.useRealTimers();
    });

    it('runs several times a day', () => {
      expect(maintenanceProcessor.schedules).toContainEqual({
        id: 'delete-ended-hours-exceptions',
        everyMs: 6 * 60 * 60 * 1000,
      });
    });

    it('removes entries that ended before now, and reports how many', async () => {
      vi.useFakeTimers({ now: new Date('2026-12-26T09:00:00Z'), toFake: ['Date'] });
      remove.mockResolvedValue(4);
      const db = {} as Database;
      await expect(
        maintenanceProcessor.process(jobNamed('delete-ended-hours-exceptions'), {
          db,
          logger,
          email,
        }),
      ).resolves.toEqual({ deleted: 4 });
      expect(remove).toHaveBeenCalledWith(db, new Date('2026-12-26T09:00:00Z'));
    });
  });

  describe('expiring lapsed holds', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('runs every minute, so a hold lets go of its space soon after its ten minutes', () => {
      expect(maintenanceProcessor.schedules).toContainEqual({
        id: 'expire-lapsed-holds',
        everyMs: 60_000,
      });
    });

    it('expires holds that ran out by now, and reports how many', async () => {
      vi.useFakeTimers({ now: new Date('2026-12-26T09:00:00Z'), toFake: ['Date'] });
      vi.mocked(expireLapsedHolds).mockResolvedValue(2);
      const db = {} as Database;
      await expect(
        maintenanceProcessor.process(jobNamed('expire-lapsed-holds'), { db, logger, email }),
      ).resolves.toEqual({ expired: 2 });
      expect(expireLapsedHolds).toHaveBeenCalledWith(db, new Date('2026-12-26T09:00:00Z'));
    });
  });

  it('deletes holds that never became bookings, a week after they settled, hourly', async () => {
    vi.useFakeTimers({ now: new Date('2026-12-26T09:00:00Z'), toFake: ['Date'] });
    vi.mocked(deleteStaleHolds).mockResolvedValue(5);
    const db = {} as Database;
    expect(maintenanceProcessor.schedules).toContainEqual({
      id: 'delete-stale-holds',
      everyMs: 60 * 60 * 1000,
    });
    await expect(
      maintenanceProcessor.process(jobNamed('delete-stale-holds'), { db, logger, email }),
    ).resolves.toEqual({ deleted: 5 });
    expect(STALE_HOLD_DAYS).toBe(7);
    expect(deleteStaleHolds).toHaveBeenCalledWith(db, new Date('2026-12-19T09:00:00Z'));
    vi.useRealTimers();
  });

  it('fails loudly on unknown job names instead of silently dropping work', async () => {
    const db = { execute: vi.fn() } as unknown as Database;
    await expect(
      maintenanceProcessor.process(jobNamed('mystery'), { db, logger, email }),
    ).rejects.toThrow(/Unknown maintenance job/);
  });
});
