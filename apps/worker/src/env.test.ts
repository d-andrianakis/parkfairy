import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  REDIS_URL: 'redis://localhost:6380',
  DATABASE_URL: 'postgres://u:p@localhost:5434/db',
};

describe('worker loadEnv', () => {
  it('applies defaults for optional settings', () => {
    expect(loadEnv(base)).toMatchObject({
      WORKER_HEALTH_PORT: 4100,
      LOG_LEVEL: 'info',
      EMAIL_SENDS_PER_SECOND: 1,
    });
  });

  it('sends as fast as it is told, within reason', () => {
    expect(loadEnv({ ...base, EMAIL_SENDS_PER_SECOND: '8' }).EMAIL_SENDS_PER_SECOND).toBe(8);
    expect(loadEnv({ ...base, EMAIL_SENDS_PER_SECOND: '' }).EMAIL_SENDS_PER_SECOND).toBe(1);
    for (const pace of ['0', '-1', '1000', 'fast']) {
      expect(() => loadEnv({ ...base, EMAIL_SENDS_PER_SECOND: pace }), pace).toThrow(
        /EMAIL_SENDS_PER_SECOND/,
      );
    }
  });

  it('points links at this machine by default', () => {
    expect(loadEnv(base).webUrl).toBe('http://localhost:3000');
    expect(
      loadEnv({
        ...base,
        BETTER_AUTH_URL: 'https://parkfairy.gr',
        RESEND_API_KEY: 'k',
        EMAIL_FROM: 'a@b.gr',
      }).webUrl,
    ).toBe('https://parkfairy.gr');
  });

  it('refuses to write emails to disk anywhere but this machine', () => {
    expect(() => loadEnv({ ...base, BETTER_AUTH_URL: 'https://parkfairy.gr' })).toThrow(
      /RESEND_API_KEY/,
    );
  });

  it('needs a sender with a key', () => {
    expect(() => loadEnv({ ...base, RESEND_API_KEY: 'k' })).toThrow(/EMAIL_FROM/);
  });

  it('needs the real origin in production, for links in emails', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      RESEND_API_KEY: 'k',
      EMAIL_FROM: 'a@b.gr',
    };
    expect(() => loadEnv(production)).toThrow(/BETTER_AUTH_URL/);
  });

  it('refuses to start without Redis', () => {
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/REDIS_URL/);
  });
});
