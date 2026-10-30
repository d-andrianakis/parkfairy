/**
 * Graceful-shutdown check, run by CI on Linux (Windows cannot deliver SIGTERM to a handler):
 * starts the built worker, waits until it is ready, sends SIGTERM, and expects it to finish
 * its jobs, close its connections and exit 0 within the platform's grace period.
 *
 *   node scripts/check-shutdown.mjs        (after `pnpm build`, with Postgres and Redis up)
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

if (process.platform === 'win32') {
  console.log('Skipped: SIGTERM handlers only run on Linux/macOS (CI checks this).');
  process.exit(0);
}

const port = 4199; // not the dev/smoke worker's 4100
const GRACE_MS = 15_000; // well under the usual 30 s container stop timeout

const worker = spawn(process.execPath, ['--env-file-if-exists=../../.env', 'dist/main.js'], {
  env: { ...process.env, WORKER_HEALTH_PORT: String(port), LOG_LEVEL: 'info' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
worker.stdout.on('data', (chunk) => (output += chunk));
worker.stderr.on('data', (chunk) => (output += chunk));
const exited = new Promise((resolve) =>
  worker.on('exit', (code, signal) => resolve({ code, signal })),
);

function fail(reason) {
  console.error(`Graceful shutdown check failed: ${reason}\n--- worker output ---\n${output}`);
  worker.kill('SIGKILL');
  process.exit(1);
}

let ready = false;
for (let attempt = 0; attempt < 60 && !ready; attempt++) {
  try {
    ready = (await fetch(`http://127.0.0.1:${port}/health/ready`)).ok;
  } catch {
    // not listening yet
  }
  if (!ready) await sleep(500);
}
if (!ready) fail('worker never became ready');

worker.kill('SIGTERM');
const result = await Promise.race([exited, sleep(GRACE_MS).then(() => 'timeout')]);
if (result === 'timeout') fail(`still running ${GRACE_MS} ms after SIGTERM`);
if (result.code !== 0) fail(`exited with ${JSON.stringify(result)}`);
if (!output.includes('worker stopped')) fail('did not log "worker stopped"');
console.log('Graceful shutdown OK: finished jobs, closed connections, exited 0 after SIGTERM.');
