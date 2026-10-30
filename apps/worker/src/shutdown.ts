export interface ShutdownParts {
  health: { close: () => unknown };
  workers: { close: (force?: boolean) => Promise<void> }[];
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
 * close unforced), then close queues and the database, and exit 0. A second signal while
 * this runs is ignored rather than starting a second shutdown. If closing fails, exit 1.
 */
export function createShutdown(parts: ShutdownParts) {
  let shuttingDown = false;
  return async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    parts.logger.info({ signal }, 'shutting down: finishing active jobs');
    parts.health.close();
    try {
      await Promise.all(parts.workers.map((worker) => worker.close()));
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
