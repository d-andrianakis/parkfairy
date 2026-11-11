import { describe, expect, it, vi } from 'vitest';
import { maintenanceProcessor } from './processors/maintenance.js';
import { ownerEmailsProcessor } from './processors/owner-emails.js';
import type { Job } from 'bullmq';
import { jobHandler, prepareQueue, type ProcessorContext } from './queues.js';

const fakeQueue = () => ({
  upsertJobScheduler: vi.fn((_id: string, _repeat: object, _template: object) =>
    Promise.resolve({} as never),
  ),
  setGlobalConcurrency: vi.fn(() => Promise.resolve(1)),
  removeGlobalConcurrency: vi.fn(() => Promise.resolve(1)),
});

describe('prepareQueue', () => {
  it('schedules each job, and holds the email queue to one job over every worker', async () => {
    const queue = fakeQueue();
    await prepareQueue(queue, ownerEmailsProcessor);
    expect(queue.upsertJobScheduler.mock.calls.map(([id]) => id)).toEqual(
      ownerEmailsProcessor.schedules.map(({ id }) => id),
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'send-owner-emails',
      { every: 30_000 },
      { name: 'send-owner-emails', opts: { removeOnComplete: 100, removeOnFail: 1000 } },
    );
    expect(queue.setGlobalConcurrency).toHaveBeenCalledWith(1);
    expect(queue.removeGlobalConcurrency).not.toHaveBeenCalled();
  });

  it('takes a limit off a queue whose processor no longer asks for one', async () => {
    const queue = fakeQueue();
    await prepareQueue(queue, maintenanceProcessor);
    expect(maintenanceProcessor.globalConcurrency).toBeUndefined();
    expect(queue.removeGlobalConcurrency).toHaveBeenCalledOnce();
    expect(queue.setGlobalConcurrency).not.toHaveBeenCalled();
  });
});

describe('jobHandler', () => {
  it('takes three parameters, so BullMQ hands each job its abort signal', () => {
    const handler = jobHandler(
      ownerEmailsProcessor,
      () => ({}) as ProcessorContext,
      new AbortController().signal,
    );
    expect(handler.length).toBe(3);
  });

  it('passes the job its context, and a signal both BullMQ and the process can abort', async () => {
    const process = vi.fn((_job: Job, _context: ProcessorContext) => Promise.resolve('done'));
    const context = { email: 'context' } as unknown as ProcessorContext;
    const job = { name: 'send-owner-emails' } as Job;
    const signals = () => process.mock.lastCall?.[1].signal;

    const bullmq = new AbortController();
    const stopping = new AbortController();
    const handler = jobHandler({ process }, () => context, stopping.signal);
    await expect(handler(job, 'token', bullmq.signal)).resolves.toBe('done');
    expect(process.mock.lastCall?.[1]).toMatchObject(context);
    expect(signals()?.aborted).toBe(false);
    bullmq.abort('cancelled');
    expect(signals()?.aborted).toBe(true);

    // A job BullMQ didn't track, as closing began: the process's signal still reaches it.
    await handler(job, 'token', new AbortController().signal);
    const untracked = signals();
    await handler(job);
    const noSignal = signals();
    stopping.abort('shutting down');
    expect(untracked?.aborted).toBe(true);
    expect(noSignal?.aborted).toBe(true);
  });
});
