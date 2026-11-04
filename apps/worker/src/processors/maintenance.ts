import { deleteEndedHoursExceptions, deleteUnconfirmedAccounts } from '@parkfairy/database';
import { sql } from 'drizzle-orm';
import { QUEUES, type QueueProcessor } from '../queues.js';

/**
 * How long an address may stay unconfirmed. Anyone can sign up with a stranger's address, so
 * these rows must not stay (GDPR). A week outlives the emailed link because signing in sends a
 * new one, so someone back after a few days still gets in.
 */
export const UNCONFIRMED_ACCOUNT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const maintenanceProcessor: QueueProcessor = {
  queue: QUEUES.maintenance,
  concurrency: 1,
  schedules: [
    { id: 'heartbeat', everyMs: 60_000 },
    { id: 'delete-unconfirmed-accounts', everyMs: DAY_MS / 4 },
    // Often enough that an entry goes within hours of its last day.
    { id: 'delete-ended-hours-exceptions', everyMs: DAY_MS / 4 },
  ],
  async process(job, { db, logger }) {
    switch (job.name) {
      case 'heartbeat': {
        // Proves the scheduler → worker → database path end to end.
        await db.execute(sql`select 1`);
        logger.debug({ jobId: job.id }, 'maintenance heartbeat');
        return { ok: true };
      }
      case 'delete-unconfirmed-accounts': {
        const before = new Date(Date.now() - UNCONFIRMED_ACCOUNT_DAYS * DAY_MS);
        const deleted = await deleteUnconfirmedAccounts(db, before);
        logger.info({ deleted }, 'unconfirmed accounts deleted');
        return { deleted };
      }
      case 'delete-ended-hours-exceptions': {
        const deleted = await deleteEndedHoursExceptions(db, new Date());
        logger.info({ deleted }, 'ended closures and special hours deleted');
        return { deleted };
      }
      default:
        throw new Error(`Unknown maintenance job "${job.name}"`);
    }
  },
};
