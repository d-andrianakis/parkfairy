import { ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '@parkfairy/database';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';

function controllerWith(execute: () => Promise<unknown>) {
  return new HealthController({ execute: vi.fn(execute) } as unknown as Database);
}

describe('HealthController', () => {
  it('reports liveness without touching dependencies', () => {
    const execute = vi.fn();
    const controller = new HealthController({ execute } as unknown as Database);
    expect(controller.getLiveness()).toEqual({ status: 'ok' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('is ready when the database answers', async () => {
    await expect(
      controllerWith(() => Promise.resolve({ rows: [] })).getReadiness(),
    ).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('reports 503 with the failing dependency when the database is down', async () => {
    const error = await controllerWith(() => Promise.reject(new Error('connection refused')))
      .getReadiness()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'error',
      checks: { database: 'down' },
    });
  });
});
