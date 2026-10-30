import type { ThrottlerStorage } from '@nestjs/throttler';
import { redisScript, runScript, type RedisEval } from '@parkfairy/auth';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/*
 * One atomic step of @nestjs/throttler's fixed window with blocking, as its memory store does
 * it: count the hit (the window starts with the first one), and once the count passes the
 * limit block the key for `blockDuration`; when the block ends counting starts afresh.
 * Returns [hits, ms until the window resets, blocked (1/0), ms until the block ends].
 */
const INCREMENT = redisScript(`
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return {tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('PTTL', KEYS[1]), 1, blockTtl}
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
local block = tonumber(ARGV[3])
if hits > tonumber(ARGV[2]) and block > 0 then
  redis.call('SET', KEYS[2], '1', 'PX', block)
  redis.call('DEL', KEYS[1])
  return {hits, ttl, 1, block}
end
return {hits, ttl, 0, 0}
`);

const seconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

const REPORT_INTERVAL_MS = 10_000;

/**
 * Rate-limit counters shared by every API instance (the default store is per process). If
 * Redis fails the request is let through and the error reported (at most every 10 s, with a
 * count): this general limit is a protection, not an access control, and failing closed would
 * turn a Redis outage into an API outage. (Sign-in and two-factor limits live in Better Auth
 * and fall back to memory instead.)
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private lastReportAt = Number.NEGATIVE_INFINITY;
  private suppressed = 0;

  constructor(
    private readonly redis: RedisEval,
    private readonly onError: (error: unknown, suppressed: number) => void,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // One hash tag for both keys, so a Redis Cluster keeps them in the same slot (the script
    // touches both atomically).
    const base = `throttle:{${throttlerName}:${key}}`;
    try {
      const [hits, ttlMs, blocked, blockMs] = (await runScript(
        this.redis,
        INCREMENT,
        2,
        `${base}:hits`,
        `${base}:blocked`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];
      return {
        totalHits: hits,
        timeToExpire: seconds(ttlMs),
        isBlocked: blocked === 1,
        timeToBlockExpire: seconds(blockMs),
      };
    } catch (error) {
      this.report(error);
      return { totalHits: 0, timeToExpire: seconds(ttl), isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  private report(error: unknown) {
    const now = Date.now();
    if (now - this.lastReportAt < REPORT_INTERVAL_MS) {
      this.suppressed += 1;
      return;
    }
    this.onError(error, this.suppressed);
    this.lastReportAt = now;
    this.suppressed = 0;
  }
}
