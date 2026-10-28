import { sql } from 'drizzle-orm';
import { QUEUES, type QueueProcessor } from '../queues.js';

export const maintenanceProcessor: QueueProcessor = {
  queue: QUEUES.maintenance,
  concurrency: 1,
  schedules: [{ id: 'heartbeat', everyMs: 60_000 }],
  async process(job, { db, logger }) {
    switch (job.name) {
      case 'heartbeat': {
        // Proves the scheduler → worker → database path end to end.
        await db.execute(sql`select 1`);
        logger.debug({ jobId: job.id }, 'maintenance heartbeat');
        return { ok: true };
      }
      default:
        throw new Error(`Unknown maintenance job "${job.name}"`);
    }
  },
};
