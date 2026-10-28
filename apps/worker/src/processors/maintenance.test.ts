import type { Database } from '@parkfairy/database';
import type { Job } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { QUEUES } from '../queues.js';
import { maintenanceProcessor } from './maintenance.js';

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

  it('fails loudly on unknown job names instead of silently dropping work', async () => {
    const db = { execute: vi.fn() } as unknown as Database;
    await expect(maintenanceProcessor.process(jobNamed('mystery'), { db, logger })).rejects.toThrow(
      /Unknown maintenance job/,
    );
  });
});
