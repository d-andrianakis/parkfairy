import { deleteUnconfirmedAccounts, type Database } from '@parkfairy/database';
import type { Job } from 'bullmq';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUEUES } from '../queues.js';
import { maintenanceProcessor, UNCONFIRMED_ACCOUNT_DAYS } from './maintenance.js';

vi.mock('@parkfairy/database', () => ({ deleteUnconfirmedAccounts: vi.fn() }));

const logger = pino({ level: 'silent' });
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
      maintenanceProcessor.process(jobNamed('heartbeat'), { db, logger }),
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
        maintenanceProcessor.process(jobNamed('delete-unconfirmed-accounts'), { db, logger }),
      ).resolves.toEqual({ deleted: 3 });

      expect(UNCONFIRMED_ACCOUNT_DAYS).toBeGreaterThan(1); // the emailed link lasts a day
      expect(remove).toHaveBeenCalledWith(db, new Date('2026-10-23T12:00:00Z'));
    });
  });

  it('fails loudly on unknown job names instead of silently dropping work', async () => {
    const db = { execute: vi.fn() } as unknown as Database;
    await expect(maintenanceProcessor.process(jobNamed('mystery'), { db, logger })).rejects.toThrow(
      /Unknown maintenance job/,
    );
  });
});
