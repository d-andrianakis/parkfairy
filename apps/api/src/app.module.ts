import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from './auth/auth.guard.js';
import { redactUrl } from './common/log-redaction.js';
import { NoStoreInterceptor } from './common/no-store.interceptor.js';
import { SafeExceptionFilter } from './common/safe-exception.filter.js';
import { AuthModule } from './auth/auth.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { OriginGuard } from './auth/origin.guard.js';
import { ConfigModule, ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { OwnerModule } from './owner/owner.module.js';
import { PlacesModule } from './places/places.module.js';
import { ParkingModule } from './parking/parking.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';

const REQUEST_ID_PATTERN = /^[\w-]{1,128}$/;

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          // Correlation id: reuse a well-formed upstream x-request-id, otherwise mint one.
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id =
              typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
                ? incoming
                : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // Log only what is needed to trace a request; headers can carry credentials.
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: redactUrl(req.url),
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
          transport: env.isProduction
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        },
      }),
    }),
    RateLimitModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    UsersModule,
    StorageModule,
    ParkingModule,
    OwnerModule,
    BookingsModule,
    PlacesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: NoStoreInterceptor },
    // Guards run in this order: rate limit → CSRF origin check → session/roles.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: OriginGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
export class AppModule {}
