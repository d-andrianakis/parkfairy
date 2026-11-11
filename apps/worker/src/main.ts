import { createServer } from 'node:http';
import { createDatabase } from '@parkfairy/database';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { pino } from 'pino';
import { chooseEmailTransport } from './email-transport.js';
import { loadEnv } from './env.js';
import { maintenanceProcessor } from './processors/maintenance.js';
import { ownerEmailsProcessor } from './processors/owner-emails.js';
import { jobHandler, prepareQueue, type QueueProcessor } from './queues.js';
import { createShutdown } from './shutdown.js';

const processors: QueueProcessor[] = [maintenanceProcessor, ownerEmailsProcessor];

const env = loadEnv();
const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { singleLine: true } },
});

// Workers block on Redis; BullMQ requires unlimited per-request retries for them.
const connection: ConnectionOptions = { url: env.REDIS_URL, maxRetriesPerRequest: null };
const database = createDatabase({
  connectionString: env.DATABASE_URL,
  max: 5,
  applicationName: 'parkfairy-worker',
});

const email = {
  transport: chooseEmailTransport(env),
  webUrl: env.webUrl,
  sendsPerSecond: env.EMAIL_SENDS_PER_SECOND,
};

const queues: Queue[] = [];
const workers: Worker[] = [];
/** Aborted on SIGTERM, for jobs BullMQ can't cancel itself. */
const stopping = new AbortController();

for (const processor of processors) {
  const queue = new Queue(processor.queue, { connection });
  queues.push(queue);
  await prepareQueue(queue, processor);

  const worker = new Worker(
    processor.queue,
    jobHandler(
      processor,
      (job) => ({
        db: database.db,
        logger: logger.child({ queue: processor.queue, job: job.name }),
        email,
      }),
      stopping.signal,
    ),
    { connection, concurrency: processor.concurrency },
  );
  worker.on('failed', (job, error) =>
    logger.error({ err: error, queue: processor.queue, jobId: job?.id }, 'job failed'),
  );
  worker.on('error', (error) =>
    logger.error({ err: error, queue: processor.queue }, 'worker error'),
  );
  workers.push(worker);
}

// Liveness/readiness for the container platform: ready while every worker holds a Redis connection.
const health = createServer((req, res) => {
  const ready = workers.every((w) => w.isRunning());
  const ok = req.url === '/health' || ready;
  res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: ok ? 'ok' : 'error' }));
});
health.listen(env.WORKER_HEALTH_PORT, () =>
  logger.info(
    { queues: processors.map((p) => p.queue), healthPort: env.WORKER_HEALTH_PORT },
    'worker started',
  ),
);

const shutdown = createShutdown({
  health,
  stop: (reason) => stopping.abort(reason),
  workers,
  queues,
  database,
  logger,
  exit: (code) => process.exit(code),
});

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));
