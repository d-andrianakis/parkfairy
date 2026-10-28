import type { Database } from '@parkfairy/database';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';

/** Queue names are shared with producers (API, outbox relay); never rename one with jobs in flight. */
export const QUEUES = {
  /** Periodic housekeeping: hold expiry sweeps, outbox dispatch, reconciliation (from phase 3). */
  maintenance: 'maintenance',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface ProcessorContext {
  db: Database;
  logger: Logger;
}

export interface ScheduledJob {
  /** Stable id: upserting the same id replaces the schedule instead of duplicating it. */
  id: string;
  everyMs: number;
}

export interface QueueProcessor {
  queue: QueueName;
  concurrency: number;
  schedules: ScheduledJob[];
  process: (job: Job, ctx: ProcessorContext) => Promise<unknown>;
}
