import { describe, expect, it, vi } from 'vitest';
import { maintenanceProcessor } from './processors/maintenance.js';
import { ownerEmailsProcessor } from './processors/owner-emails.js';
import { prepareQueue } from './queues.js';

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
