// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAuth = vi.hoisted(() => vi.fn((options: unknown) => ({ options })));
const createDatabase = vi.hoisted(() => vi.fn(() => ({ db: 'db' })));
const redisInstances = vi.hoisted(() => [] as unknown[]);

vi.mock('@parkfairy/auth', () => ({
  createAuth,
  parseOrigins: (value: string) => [value],
  redisRateLimitStorage: (redis: unknown) => ({ redis }),
}));
vi.mock('@parkfairy/database', () => ({ createDatabase }));
vi.mock('ioredis', () => ({
  Redis: class {
    constructor(...args: unknown[]) {
      redisInstances.push(args);
    }
  },
}));

const env = {
  DATABASE_URL: 'postgres://u:p@localhost:5434/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  ADMIN_URL: 'http://localhost:3001',
};

async function load(extra: Record<string, string> = {}) {
  vi.resetModules();
  createAuth.mockClear();
  redisInstances.length = 0;
  Object.assign(process.env, env, extra);
  delete (globalThis as { parkfairyAdminAuth?: unknown }).parkfairyAdminAuth;
  delete (globalThis as { parkfairyAdminRedis?: unknown }).parkfairyAdminRedis;
  delete (globalThis as { parkfairyAdminDb?: unknown }).parkfairyAdminDb;
  return (await import('./auth')).getAuth;
}
const optionsOf = () =>
  createAuth.mock.calls[0]?.[0] as unknown as {
    baseURL: string;
    trustedOrigins: string[];
    rateLimitStorage?: unknown;
    sendEmail: (email: unknown) => unknown;
  };

beforeEach(() => {
  delete process.env.REDIS_URL;
  delete process.env.TRUSTED_PROXIES;
});

describe('the staff app’s Better Auth', () => {
  it('lives on the staff origin and trusts that origin only, never the public site’s', async () => {
    const getAuth = await load();
    getAuth();
    expect(optionsOf().baseURL).toBe('http://localhost:3001');
    expect(optionsOf().trustedOrigins).toEqual(['http://localhost:3001']);
  });

  it('sends no email, whatever asks: a refused sign-in mails nobody', async () => {
    const getAuth = await load();
    getAuth();
    expect(() => optionsOf().sendEmail({ kind: 'verify-email' })).not.toThrow();
    expect(optionsOf().sendEmail({ kind: 'verify-email' })).toBeUndefined();
  });

  it('shares its rate limits through Redis when there is one, and counts in memory when not', async () => {
    let getAuth = await load();
    getAuth();
    expect(optionsOf().rateLimitStorage).toBeUndefined();
    expect(redisInstances).toHaveLength(0);
    getAuth = await load({ REDIS_URL: 'redis://localhost:6380' });
    getAuth();
    expect(optionsOf().rateLimitStorage).toBeDefined();
    expect(redisInstances).toHaveLength(1);
  });

  it('is built once and reused, with a small pool and a short statement limit', async () => {
    const getAuth = await load();
    expect(getAuth()).toBe(getAuth());
    expect(createAuth).toHaveBeenCalledTimes(1);
    expect(createDatabase).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 3,
        statementTimeoutMs: 3000,
        applicationName: 'parkfairy-admin',
      }),
    );
  });
});
