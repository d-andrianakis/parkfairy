import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { ConfigModule, ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

export const RATE_LIMIT_REDIS = Symbol('RATE_LIMIT_REDIS');

/**
 * The rate-limit Redis client. At start-up commands wait briefly for the connection (no free
 * pass for the first requests); once connected, they fail at once while Redis is away instead
 * of queueing behind the 500 ms timeout (and being replayed, stale, on reconnect).
 */
export function createRateLimitRedis(url: string): Redis {
  const redis = new Redis(url, {
    commandTimeout: 500,
    maxRetriesPerRequest: 1,
    connectionName: 'parkfairy-api-rate-limit',
  });
  redis.once('ready', () => {
    redis.options.enableOfflineQueue = false;
  });
  return redis;
}

/** Redis for shared rate-limit counters; null without REDIS_URL (per-process counting). */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: RATE_LIMIT_REDIS,
      inject: [ENV],
      useFactory: (env: Env) => (env.REDIS_URL ? createRateLimitRedis(env.REDIS_URL) : null),
    },
  ],
  exports: [RATE_LIMIT_REDIS],
})
class RateLimitRedisModule implements OnApplicationShutdown {
  constructor(@Inject(RATE_LIMIT_REDIS) private readonly redis: Redis | null) {}

  async onApplicationShutdown() {
    // QUIT needs a connection; a client still trying to connect is just dropped.
    if (this.redis?.status === 'ready') await this.redis.quit();
    else this.redis?.disconnect();
  }
}

const logger = new Logger('RateLimit');

/**
 * Global request limits (120 per minute per client), shared across instances through Redis.
 * The client is `req.ip`, so `TRUST_PROXY` must match the proxies in front (memory.md).
 */
export const RateLimitModule = ThrottlerModule.forRootAsync({
  imports: [RateLimitRedisModule],
  inject: [RATE_LIMIT_REDIS],
  useFactory: (redis: Redis | null) => ({
    throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
    storage: redis
      ? new RedisThrottlerStorage(redis, (error, suppressed) =>
          logger.error({ err: error, suppressed }, 'Rate-limit storage failed; requests allowed'),
        )
      : undefined,
  }),
});
