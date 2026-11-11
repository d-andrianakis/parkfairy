import { describe, expect, it, vi } from 'vitest';
import { createShutdown } from './shutdown.js';

function parts() {
  const events: string[] = [];
  let finishJob = () => {};
  const job = new Promise<void>((resolve) => (finishJob = resolve));
  return {
    events,
    finishJob,
    shutdownParts: {
      health: { close: vi.fn(() => events.push('health closed')) },
      workers: [
        {
          close: vi.fn(async (force?: boolean) => {
            events.push(force ? 'worker forced' : 'worker closing');
            await job; // a job still running
            events.push('worker closed');
          }),
          cancelAllJobs: vi.fn(() => events.push('jobs told to stop')),
        },
      ],
      queues: [{ close: vi.fn(() => Promise.resolve(void events.push('queue closed'))) }],
      database: { close: vi.fn(() => Promise.resolve(void events.push('database closed'))) },
      logger: { info: vi.fn(), error: vi.fn() },
      exit: vi.fn((code: number) => void events.push(`exit ${code}`)),
    },
  };
}

describe('createShutdown', () => {
  it('lets running jobs finish before closing queues and the database, then exits 0', async () => {
    const { events, finishJob, shutdownParts } = parts();
    const done = createShutdown(shutdownParts)('SIGTERM');

    await Promise.resolve();
    // Waiting on the job, which was told to stop once no other could start.
    expect(events).toEqual(['health closed', 'worker closing', 'jobs told to stop']);
    expect(shutdownParts.workers[0]?.cancelAllJobs).toHaveBeenCalledWith('shutting down');
    finishJob();
    await done;

    expect(events).toEqual([
      'health closed',
      'worker closing',
      'jobs told to stop',
      'worker closed',
      'queue closed',
      'database closed',
      'exit 0',
    ]);
    expect(shutdownParts.logger.info).toHaveBeenLastCalledWith('worker stopped');
  });

  it('ignores a second signal while shutting down', async () => {
    const { finishJob, shutdownParts } = parts();
    const shutdown = createShutdown(shutdownParts);
    const first = shutdown('SIGTERM');
    await shutdown('SIGINT');
    finishJob();
    await first;

    expect(shutdownParts.workers[0]?.close).toHaveBeenCalledTimes(1);
    expect(shutdownParts.exit).toHaveBeenCalledTimes(1);
  });

  it('still exits, with 1, when closing fails', async () => {
    const { finishJob, shutdownParts } = parts();
    shutdownParts.database.close.mockRejectedValue(new Error('connection lost'));
    const done = createShutdown(shutdownParts)('SIGTERM');
    finishJob();
    await done;

    const [[logged, message]] = shutdownParts.logger.error.mock.calls as [[{ err: Error }, string]];
    expect(logged.err.message).toBe('connection lost');
    expect(message).toBe('shutdown failed');
    expect(shutdownParts.exit).toHaveBeenCalledWith(1);
  });
});
