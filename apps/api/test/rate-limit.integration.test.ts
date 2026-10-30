import { randomUUID } from 'node:crypto';
import { authRateLimitKey, redisRateLimitStorage } from '@parkfairy/auth';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRateLimitRedis } from '../src/rate-limit/rate-limit.module.js';
import { RedisThrottlerStorage } from '../src/rate-limit/redis-throttler.storage.js';
import { createTestApp, type TestApp } from './test-app.js';

// Real Redis (docker compose locally, a service in CI), on a logical database of its own
// (TEST_REDIS_URL, see vitest.config.ts) that is emptied first: the scripts must behave like
// the in-memory stores they replace, across instances.
const redisUrl = process.env.TEST_REDIS_URL ?? '';
const run = randomUUID().slice(0, 8);
const UNREACHABLE_REDIS = 'redis://127.0.0.1:1';

/** FLUSHDB only a local, non-default database: never someone's shared or default one. */
function assertDisposableRedis(url: string) {
  const parsed = new URL(url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const database = Number(parsed.pathname.slice(1) || '0');
  if (!local || database === 0) {
    throw new Error(`Refusing to flush ${parsed.host}/${database}: use a local, non-zero database`);
  }
}

const throttleKey = (key: string) => `throttle:{default:${key}}`;

describe('rate limits shared through Redis', () => {
  let redis: Redis;

  beforeAll(async () => {
    if (!redisUrl) throw new Error('TEST_REDIS_URL (or REDIS_URL) must point at a Redis');
    assertDisposableRedis(redisUrl);
    redis = new Redis(redisUrl);
    await redis.flushdb();
  });
  afterAll(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  it('API: counts per key, blocks past the limit, then starts afresh', async () => {
    const storage = new RedisThrottlerStorage(redis, vi.fn());
    const hit = () => storage.increment(`key-${run}`, 60_000, 3, 30_000, 'default');

    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false });
    // Counters expire with their window; nothing is kept for ever.
    const ttl = await redis.pttl(`${throttleKey(`key-${run}`)}:hits`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);

    for (const expected of [2, 3]) {
      expect(await hit()).toMatchObject({ totalHits: expected, isBlocked: false });
    }
    const blocked = await hit();
    expect(blocked).toMatchObject({ isBlocked: true });
    expect(blocked.timeToBlockExpire).toBeGreaterThan(25);
    expect(await hit()).toMatchObject({ isBlocked: true }); // still blocked

    await redis.del(`${throttleKey(`key-${run}`)}:blocked`); // the block runs out
    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('API: counts the very first request after start-up (no free pass while connecting)', async () => {
    const fresh = createRateLimitRedis(redisUrl);
    try {
      const storage = new RedisThrottlerStorage(fresh, vi.fn());
      // Sent before the connection is up: it waits for it instead of failing open.
      expect(await storage.increment(`first-${run}`, 60_000, 3, 30_000, 'default')).toMatchObject({
        totalHits: 1,
      });
    } finally {
      await fresh.quit();
    }
  });

  it('Better Auth: refuses past max within the window, with seconds to wait', async () => {
    const storage = redisRateLimitStorage(redis);
    const consume = () => storage.consume(`sign-in-${run}`, { window: 10, max: 3 });

    for (let i = 0; i < 3; i++) expect((await consume()).allowed).toBe(true);
    const ttl = await redis.pttl(authRateLimitKey(`sign-in-${run}`));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10_000);

    const refused = await consume();
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBeGreaterThanOrEqual(1);
    expect(refused.retryAfter).toBeLessThanOrEqual(10);
  });

  it('Better Auth: starts a new window once the old one has passed', async () => {
    const storage = redisRateLimitStorage(redis);
    const key = `window-${run}`;
    const rule = { window: 10, max: 3 };
    for (let i = 0; i < 3; i++) await storage.consume(key, rule);
    expect((await storage.consume(key, rule)).allowed).toBe(false);

    const [seconds, micros] = await redis.time();
    const serverNow = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
    await redis.hset(authRateLimitKey(key), 'last', serverNow - 11_000);

    expect(await storage.consume(key, rule)).toEqual({ allowed: true, retryAfter: null });
    expect(await redis.hget(authRateLimitKey(key), 'count')).toBe('1');
  });

  describe('end to end, per client address', () => {
    let app: TestApp;
    beforeAll(async () => {
      // This app counts in Redis, unlike the other suites' apps.
      process.env.REDIS_URL = redisUrl;
      app = await createTestApp();
      process.env.REDIS_URL = '';
    });
    afterAll(async () => {
      await app.close();
    });

    it('answers 429 after 120 requests a minute from one client, and only for that client', async () => {
      // Distinct documentation addresses per run, forwarded as the web app does.
      const client = `198.51.100.${(Number.parseInt(run, 16) % 200) + 1}`;
      const other = `203.0.113.${(Number.parseInt(run, 16) % 200) + 1}`;
      const get = (ip: string) =>
        request(app.getHttpServer()).get('/v1/parking/featured').set('x-forwarded-for', ip);

      const statuses = [];
      for (let i = 0; i < 121; i++) statuses.push((await get(client)).status);
      expect(statuses.slice(0, 120).every((status) => status === 200)).toBe(true);
      expect(statuses[120]).toBe(429);
      expect((await get(other)).status).toBe(200);
      // The block lives in Redis, so every API instance sees it.
      expect(await redis.keys('throttle:{default:*}:blocked')).toHaveLength(1);
    });
  });

  describe('with Redis unreachable', () => {
    let app: TestApp;
    beforeAll(async () => {
      process.env.REDIS_URL = UNREACHABLE_REDIS;
      app = await createTestApp();
      process.env.REDIS_URL = '';
    });
    afterAll(async () => {
      await app.close();
    });

    it('API: keeps serving, without waiting long on Redis', async () => {
      const started = Date.now();
      const response = await request(app.getHttpServer()).get('/v1/parking/featured');
      expect(response.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('Better Auth: still limits sign-in attempts, in memory', async () => {
      const down = new Redis(UNREACHABLE_REDIS, {
        commandTimeout: 200,
        maxRetriesPerRequest: 0,
        lazyConnect: true,
      });
      try {
        const storage = redisRateLimitStorage(down, vi.fn());
        const consume = () => storage.consume(`down-${run}`, { window: 10, max: 3 });
        for (let i = 0; i < 3; i++) expect((await consume()).allowed).toBe(true);
        expect((await consume()).allowed).toBe(false);
      } finally {
        down.disconnect();
      }
    });
  });
});
