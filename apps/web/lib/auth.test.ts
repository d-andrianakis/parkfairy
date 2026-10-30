// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryRateLimitStorage, type AuthEmail } from '@parkfairy/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: vi.fn() }));
const { emailDelivery } = await import('./auth');
const { parseServerEnv } = await import('./server-env');
const { register } = await import('@/instrumentation');
const { after } = await import('next/server');

const base = {
  DATABASE_URL: 'postgres://parkfairy@localhost:5434/parkfairy',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://parkfairy.example',
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'Parkfairy <no-reply@parkfairy.example>',
};

describe('parseServerEnv', () => {
  it('treats an empty REDIS_URL as unset (counting per instance) outside production', () => {
    const env = parseServerEnv({ ...base, NODE_ENV: 'development', REDIS_URL: '' });
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.trustedProxies).toEqual([]);
  });

  it('splits and trims the trusted proxy list; "none" means none', () => {
    expect(
      parseServerEnv({ ...base, TRUSTED_PROXIES: ' 10.0.0.0/8, 192.0.2.10 ' }).trustedProxies,
    ).toEqual(['10.0.0.0/8', '192.0.2.10']);
    expect(parseServerEnv({ ...base, TRUSTED_PROXIES: 'none' }).trustedProxies).toEqual([]);
  });

  it('refuses to start in production without shared counters or an explicit proxy setting', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis.internal:6379',
      TRUSTED_PROXIES: 'none',
    };
    expect(() => parseServerEnv(production)).not.toThrow();
    expect(() => parseServerEnv({ ...production, REDIS_URL: '' })).toThrow(/REDIS_URL/);
    expect(() => parseServerEnv({ ...production, TRUSTED_PROXIES: '' })).toThrow(/TRUSTED_PROXIES/);
  });

  it('writes emails to files only on this machine: a deployment must really send them', () => {
    const noResend = { ...base, RESEND_API_KEY: '', EMAIL_FROM: '' };
    expect(() => parseServerEnv(noResend)).toThrow(/RESEND_API_KEY/);
    expect(() => parseServerEnv({ ...noResend, NODE_ENV: 'development' })).toThrow(
      /RESEND_API_KEY/,
    );
    // A look-alike host is not this machine.
    expect(() =>
      parseServerEnv({ ...noResend, BETTER_AUTH_URL: 'https://localhost.parkfairy.example' }),
    ).toThrow(/RESEND_API_KEY/);

    for (const url of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      expect(parseServerEnv({ ...noResend, BETTER_AUTH_URL: url }).resend).toBeUndefined();
    }
  });

  it('needs a sender with the Resend key, and uses Resend whenever a key is set', () => {
    expect(() => parseServerEnv({ ...base, EMAIL_FROM: '' })).toThrow(/EMAIL_FROM/);
    expect(parseServerEnv(base).resend).toEqual({
      apiKey: 're_test',
      from: 'Parkfairy <no-reply@parkfairy.example>',
    });
    expect(
      parseServerEnv({ ...base, BETTER_AUTH_URL: 'http://localhost:3000' }).resend,
    ).toBeDefined();
  });

  it('names the variable when BETTER_AUTH_URL is not a URL', () => {
    expect(() =>
      parseServerEnv({ ...base, RESEND_API_KEY: '', BETTER_AUTH_URL: 'not a url' }),
    ).toThrow(/BETTER_AUTH_URL/);
  });

  it('refuses a sender Resend would reject on every send', () => {
    for (const from of ['parkfairy', 'Parkfairy <no-reply>', 'a@b', 'x <a@b.gr', 'a b@c.gr']) {
      expect(() => parseServerEnv({ ...base, EMAIL_FROM: from }), from).toThrow(/EMAIL_FROM/);
    }
    for (const from of ['no-reply@parkfairy.gr', 'Parkfairy Team <s.user@mail.parkfairy.gr>']) {
      expect(parseServerEnv({ ...base, EMAIL_FROM: from }).resend?.from).toBe(from);
    }
  });

  it('refuses proxy entries that are not addresses or ranges (Better Auth would drop them)', () => {
    for (const entry of ['lb.internal', '10.0.0.0/33', '10.0.0.1/8/1', 'fd00::/129']) {
      expect(() => parseServerEnv({ ...base, TRUSTED_PROXIES: entry }), entry).toThrow(
        /TRUSTED_PROXIES/,
      );
    }
    expect(
      parseServerEnv({ ...base, TRUSTED_PROXIES: '10.0.0.0/8, fd00::/8, 192.0.2.1' })
        .trustedProxies,
    ).toEqual(['10.0.0.0/8', 'fd00::/8', '192.0.2.1']);
  });
});

describe('register (server start)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DATABASE_URL', base.DATABASE_URL);
    vi.stubEnv('BETTER_AUTH_SECRET', base.BETTER_AUTH_SECRET);
    vi.stubEnv('REDIS_URL', 'redis://redis.internal:6379');
    vi.stubEnv('TRUSTED_PROXIES', 'none');
    vi.stubEnv('EMAIL_FROM', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('stops a deployment that cannot send email: Next would log it and serve on', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('BETTER_AUTH_URL', 'https://parkfairy.example');
    vi.stubEnv('RESEND_API_KEY', '');

    await register();

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(String(log.mock.calls[0]?.[1])).toMatch(/RESEND_API_KEY/);
  });

  it('starts with a working configuration', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
    vi.stubEnv('RESEND_API_KEY', '');
    await register();
    expect(exit).not.toHaveBeenCalled();
  });

  it('checks nothing on the edge runtime, which has no such variables', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('BETTER_AUTH_URL', 'https://parkfairy.example');
    vi.stubEnv('RESEND_API_KEY', '');
    await register();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('emailDelivery', () => {
  const email: AuthEmail = {
    kind: 'verify-email',
    to: 'maria@example.gr',
    locale: 'en',
    url: 'https://parkfairy.example/en/verify-email?token=t',
  };
  const scheduled = vi.mocked(after);
  let outbox = '';

  beforeEach(() => {
    outbox = mkdtempSync(join(tmpdir(), 'parkfairy-delivery-'));
    scheduled.mockReset();
  });
  afterEach(() => {
    rmSync(outbox, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const runScheduled = async () => {
    const [work] = scheduled.mock.calls[0] ?? [];
    await (work as () => Promise<void>)();
  };

  it('writes to the outbox without a key, and only once the response is done', async () => {
    const env = parseServerEnv({
      ...base,
      RESEND_API_KEY: '',
      EMAIL_FROM: '',
      BETTER_AUTH_URL: 'http://localhost:3000',
      EMAIL_OUTBOX_DIR: outbox,
    });
    emailDelivery(env, memoryRateLimitStorage())(email);

    expect(scheduled).toHaveBeenCalledOnce();
    expect(readdirSync(outbox)).toEqual([]);

    await runScheduled();
    expect(readdirSync(outbox)).toHaveLength(1);
  });

  it('sends through Resend with a key, whatever the outbox setting says', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const env = parseServerEnv({ ...base, EMAIL_OUTBOX_DIR: outbox });

    emailDelivery(env, memoryRateLimitStorage())(email);
    await runScheduled();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readdirSync(outbox)).toEqual([]);
  });

  it('counts recipients in the store it is given', async () => {
    const limits = memoryRateLimitStorage();
    const consume = vi.spyOn(limits, 'consume');
    const env = parseServerEnv({
      ...base,
      RESEND_API_KEY: '',
      EMAIL_FROM: '',
      BETTER_AUTH_URL: 'http://localhost:3000',
      EMAIL_OUTBOX_DIR: outbox,
    });

    emailDelivery(env, limits)(email);
    await runScheduled();

    expect(consume).toHaveBeenCalled();
  });
});
