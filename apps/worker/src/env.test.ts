import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  REDIS_URL: 'redis://localhost:6380',
  DATABASE_URL: 'postgres://u:p@localhost:5434/db',
};

describe('worker loadEnv', () => {
  it('applies defaults for optional settings', () => {
    expect(loadEnv(base)).toMatchObject({ WORKER_HEALTH_PORT: 4100, LOG_LEVEL: 'info' });
  });

  it('refuses to start without Redis', () => {
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/REDIS_URL/);
  });
});
