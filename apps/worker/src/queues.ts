import type { Database } from '@parkfairy/database';
import type { EmailTransport } from '@parkfairy/email';
import type { Job, Queue } from 'bullmq';
import type { Logger } from 'pino';

/** Queue names are shared with producers (API, outbox relay); never rename one with jobs in flight. */
export const QUEUES = {
  /** Periodic housekeeping: hold expiry sweeps, outbox dispatch, reconciliation (from phase 3). */
  maintenance: 'maintenance',
  /** Emails owed to people: outbox sweeps and the sender. */
  email: 'email',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface ProcessorContext {
  db: Database;
  logger: Logger;
  email: {
    transport: EmailTransport;
    webUrl: string;
    /** The transport's pace, which sizes the sender's claims to the time it has. */
    sendsPerSecond: number;
  };
  /**
   * Aborted when the worker shuts down (BullMQ's `cancelAllJobs`). A long job stops at its next
   * safe point and leaves the rest for the next run, so the platform's stop timeout is enough.
   */
  signal?: AbortSignal | undefined;
}

export interface ScheduledJob {
  /** Stable id: upserting the same id replaces the schedule instead of duplicating it. */
  id: string;
  everyMs: number;
}

export interface QueueProcessor {
  queue: QueueName;
  concurrency: number;
  /** The most jobs of the queue running at once across every worker process; none if left out. */
  globalConcurrency?: number;
  schedules: ScheduledJob[];
  process: (job: Job, ctx: ProcessorContext) => Promise<unknown>;
}

/**
 * What a processor asks of its queue in Redis: its schedules, and how many of its jobs may run at
 * once over every worker process. Redis keeps that limit for the queue, so a processor without
 * one has it removed: taking it out of the code takes it out there too.
 */
export async function prepareQueue(
  queue: Pick<Queue, 'upsertJobScheduler' | 'setGlobalConcurrency' | 'removeGlobalConcurrency'>,
  { schedules, globalConcurrency }: Pick<QueueProcessor, 'schedules' | 'globalConcurrency'>,
): Promise<void> {
  for (const schedule of schedules) {
    await queue.upsertJobScheduler(
      schedule.id,
      { every: schedule.everyMs },
      {
        name: schedule.id,
        opts: { removeOnComplete: 100, removeOnFail: 1000 },
      },
    );
  }
  if (globalConcurrency) await queue.setGlobalConcurrency(globalConcurrency);
  else await queue.removeGlobalConcurrency();
}

/**
 * The function BullMQ runs for a processor's jobs. Its three parameters are what make BullMQ hand
 * a job its abort signal (it checks `processor.length >= 3`), which `cancelAllJobs` aborts on
 * shutdown: written as `(job) => …` the sender would only stop at its own deadline. `stopping`,
 * the process's own, reaches a job BullMQ fetched as closing began, which it doesn't track yet
 * and so can't cancel.
 */
export function jobHandler(
  processor: Pick<QueueProcessor, 'process'>,
  context: (job: Job) => Omit<ProcessorContext, 'signal'>,
  stopping: AbortSignal,
) {
  return (job: Job, _token?: string, signal?: AbortSignal) =>
    processor.process(job, {
      ...context(job),
      signal: signal ? AbortSignal.any([signal, stopping]) : stopping,
    });
}
