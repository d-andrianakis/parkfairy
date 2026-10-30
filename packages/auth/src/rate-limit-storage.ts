import { createHash } from 'node:crypto';
import type { BetterAuthOptions } from 'better-auth';

export type RateLimitStorage = NonNullable<
  NonNullable<BetterAuthOptions['rateLimit']>['customStorage']
>;

/** The Redis calls this needs; ioredis satisfies them, so this package has no Redis dependency. */
export interface RedisEval {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  evalsha(sha1: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** A Lua script and its hash, computed once. */
export function redisScript(source: string) {
  return { source, sha1: createHash('sha1').update(source).digest('hex') };
}

/**
 * Runs a script by its hash, so its text isn't sent on every request. Redis forgets scripts on
 * a restart or failover and answers NOSCRIPT; the full text then loads it again.
 */
export async function runScript(
  redis: RedisEval,
  { source, sha1 }: ReturnType<typeof redisScript>,
  numKeys: number,
  ...args: (string | number)[]
): Promise<unknown> {
  try {
    return await redis.evalsha(sha1, numKeys, ...args);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('NOSCRIPT')) throw error;
    return redis.eval(source, numKeys, ...args);
  }
}

/*
 * Better Auth's rolling window, atomically in Redis (one script, so concurrent requests on
 * several web instances cannot all pass a stale read). Same rules as its memory store: a new
 * or expired window starts at 1; at `max` the request is refused until the window has passed.
 * Uses Redis's clock, so web instances with skewed clocks agree.
 */
const CONSUME = redisScript(`
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
local max = tonumber(ARGV[2])
local data = redis.call('HMGET', KEYS[1], 'count', 'last')
local count = tonumber(data[1])
local last = tonumber(data[2])
if not count or now - last >= window then
  redis.call('HSET', KEYS[1], 'count', 1, 'last', now)
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, 0}
end
if count >= max then
  return {0, math.ceil((last + window - now) / 1000)}
end
redis.call('HSET', KEYS[1], 'count', count + 1, 'last', now)
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0}
`);

/**
 * Better Auth's key is the client address plus the raw request path, and it is counted before
 * routing, so an attacker chooses its length. Hashing bounds every key to the same size.
 */
export function authRateLimitKey(key: string): string {
  return `auth-rate-limit:${createHash('sha256').update(key).digest('hex')}`;
}

const FALLBACK_MAX_KEYS = 100_000; // as Better Auth's own memory store
const REPORT_INTERVAL_MS = 10_000;

/**
 * The same rolling window in process memory, for while Redis is unavailable: limits then hold
 * per instance instead of across instances, but they hold. Bounded; the oldest window goes.
 */
export function memoryRateLimitStorage(
  maxKeys = FALLBACK_MAX_KEYS,
  now: () => number = Date.now,
): RateLimitStorage {
  const windows = new Map<string, { count: number; last: number }>();
  return {
    consume(key, rule) {
      const time = now();
      const windowMs = rule.window * 1000;
      const entry = windows.get(key);
      if (!entry || time - entry.last >= windowMs) {
        windows.delete(key);
        if (windows.size >= maxKeys) windows.delete(windows.keys().next().value ?? '');
        windows.set(key, { count: 1, last: time });
        return Promise.resolve({ allowed: true, retryAfter: null });
      }
      if (entry.count >= rule.max) {
        const retryAfter = Math.max(1, Math.ceil((entry.last + windowMs - time) / 1000));
        return Promise.resolve({ allowed: false, retryAfter });
      }
      entry.count += 1;
      entry.last = time;
      return Promise.resolve({ allowed: true, retryAfter: null });
    },
  };
}

/** Calls `report` at most once per interval, with how many errors were skipped since. */
function throttledReporter(
  report: (error: unknown, suppressed: number) => void,
  intervalMs = REPORT_INTERVAL_MS,
) {
  let lastAt = Number.NEGATIVE_INFINITY;
  let suppressed = 0;
  return (error: unknown) => {
    const time = Date.now();
    if (time - lastAt < intervalMs) {
      suppressed += 1;
      return;
    }
    report(error, suppressed);
    lastAt = time;
    suppressed = 0;
  };
}

/**
 * Rate-limit storage shared by every web instance (the default memory store is per process).
 * If Redis fails, counting falls back to this process's memory: these limits are the only
 * brute-force control on sign-in and two-factor codes, so they must not simply disappear
 * (and an attacker who can upset Redis must not be able to switch them off). Errors are
 * reported at most every 10 s, with a count, so an outage does not flood the logs.
 */
export function redisRateLimitStorage(
  redis: RedisEval,
  onError: (error: unknown, suppressed: number) => void = (error, suppressed) =>
    console.error('Rate-limit storage failed; counting in memory', { suppressed }, error),
): RateLimitStorage {
  const fallback = memoryRateLimitStorage();
  const report = throttledReporter(onError);
  return {
    async consume(key, rule) {
      const hashed = authRateLimitKey(key);
      try {
        const [allowed, retryAfter] = (await runScript(
          redis,
          CONSUME,
          1,
          hashed,
          rule.window * 1000,
          rule.max,
        )) as [number, number];
        return allowed === 1
          ? { allowed: true, retryAfter: null }
          : { allowed: false, retryAfter: Math.max(1, retryAfter) };
      } catch (error) {
        report(error);
        return fallback.consume(hashed, rule);
      }
    },
  };
}
