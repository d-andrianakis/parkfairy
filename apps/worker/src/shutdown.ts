export interface ShutdownParts {
  health: { close: () => unknown };
  /** Tells every running job to stop, including one BullMQ fetched as closing began. */
  stop: (reason: string) => void;
  workers: {
    close: (force?: boolean) => Promise<void>;
    cancelAllJobs: (reason?: string) => void;
  }[];
  queues: { close: () => Promise<void> }[];
  database: { close: () => Promise<void> };
  logger: {
    info: (...args: [object, string] | [string]) => void;
    error: (object: object, message: string) => void;
  };
  exit: (code: number) => void;
}

/**
 * The SIGTERM/SIGINT handler: stop taking health checks, let running jobs finish (workers
 * close unforced), then close queues and the database, and exit 0. Running jobs are told to stop
 * too (their signal), so a long one, the email sender in a rush, stops at its next safe point
 * instead of outlasting the platform's stop timeout. A second signal while this runs is ignored
 * rather than starting a second shutdown. If closing fails, exit 1.
 */
export function createShutdown(parts: ShutdownParts) {
  let shuttingDown = false;
  return async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    parts.logger.info({ signal }, 'shutting down: finishing active jobs');
    parts.health.close();
    parts.stop('shutting down');
    try {
      await Promise.all(
        parts.workers.map((worker) => {
          // Closing first: no new job starts after the running ones are told to stop.
          const closed = worker.close();
          worker.cancelAllJobs('shutting down');
          return closed;
        }),
      );
      await Promise.all(parts.queues.map((queue) => queue.close()));
      await parts.database.close();
    } catch (error) {
      // Still exit, and say it failed: the platform restarts or alerts on non-zero.
      parts.logger.error({ err: error }, 'shutdown failed');
      parts.exit(1);
      return;
    }
    parts.logger.info('worker stopped');
    parts.exit(0);
  };
}
