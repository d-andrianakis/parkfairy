import { createDatabase } from '@parkfairy/database';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createAuth } from './index.js';
import {
  authRateLimitKey,
  memoryRateLimitStorage,
  redisRateLimitStorage,
  type RedisEval,
} from './rate-limit-storage.js';

const rule = { window: 10, max: 3 };

function redisAnswering(result: unknown): RedisEval {
  return { eval: vi.fn().mockResolvedValue(result) };
}

describe('redisRateLimitStorage', () => {
  it('runs one atomic script per request, hashed key, window in milliseconds', async () => {
    const evalScript = vi.fn().mockResolvedValue([1, 0]);
    const redis: RedisEval = { eval: evalScript };
    await expect(redisRateLimitStorage(redis).consume('1.2.3.4/sign-in', rule)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(evalScript).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('TIME')"),
      1,
      authRateLimitKey('1.2.3.4/sign-in'),
      10_000,
      3,
    );
  });

  it('refuses with the seconds left in the window', async () => {
    await expect(redisRateLimitStorage(redisAnswering([0, 7])).consume('k', rule)).resolves.toEqual(
      { allowed: false, retryAfter: 7 },
    );
  });

  it('bounds every key, whatever the request path (attackers choose its length)', () => {
    const key = authRateLimitKey(`1.2.3.4/${'x'.repeat(15_000)}`);
    expect(key).toMatch(/^auth-rate-limit:[0-9a-f]{64}$/);
    expect(authRateLimitKey('1.2.3.4/sign-in')).not.toBe(authRateLimitKey('1.2.3.5/sign-in'));
  });

  it('keeps limiting in memory when Redis fails, and reports at most every 10 s', async () => {
    const onError = vi.fn();
    const redis: RedisEval = { eval: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const storage = redisRateLimitStorage(redis, onError);

    for (let i = 0; i < 3; i++) {
      await expect(storage.consume('k', rule)).resolves.toEqual({
        allowed: true,
        retryAfter: null,
      });
    }
    const refused = await storage.consume('k', rule);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBeGreaterThanOrEqual(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'ECONNREFUSED' }), 0);
  });
});

describe('memoryRateLimitStorage', () => {
  it('follows Better Auth’s rolling window: refuse at max, start afresh once it has passed', async () => {
    let now = 1_000_000;
    const storage = memoryRateLimitStorage(100, () => now);
    for (let i = 0; i < 3; i++) expect((await storage.consume('k', rule)).allowed).toBe(true);
    now += 4_000;
    expect(await storage.consume('k', rule)).toEqual({ allowed: false, retryAfter: 6 });

    now += 6_000; // 10 s after the last allowed request
    expect(await storage.consume('k', rule)).toEqual({ allowed: true, retryAfter: null });
  });

  it('forgets the oldest window when full, so memory stays bounded', async () => {
    const storage = memoryRateLimitStorage(2);
    for (let i = 0; i < 3; i++) await storage.consume('a', rule);
    await storage.consume('b', rule);
    await storage.consume('c', rule); // evicts 'a'
    expect((await storage.consume('a', rule)).allowed).toBe(true);
  });
});

describe('createAuth rate limiting and proxies', () => {
  const connection = createDatabase({ connectionString: 'postgres://unused@127.0.0.1:1/unused' });
  afterAll(() => connection.close());
  const base = {
    db: connection.db,
    secret: 'x'.repeat(32),
    baseURL: 'https://parkfairy.example',
    trustedOrigins: ['https://parkfairy.example'],
  };

  it('uses the shared storage and trusted proxies when given', () => {
    const storage = redisRateLimitStorage(redisAnswering([1, 0]));
    const { options } = createAuth({
      ...base,
      rateLimitStorage: storage,
      trustedProxies: ['10.0.0.0/24'],
    });
    expect(options.rateLimit?.customStorage).toBe(storage);
    expect(options.advanced?.ipAddress?.trustedProxies).toEqual(['10.0.0.0/24']);
  });

  it('keeps Better Auth’s defaults otherwise', () => {
    const { options } = createAuth(base);
    expect(options.rateLimit).toBeUndefined();
    expect(options.advanced?.ipAddress).toBeUndefined();
  });
});
