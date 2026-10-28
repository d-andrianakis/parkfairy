import { Global, Module } from '@nestjs/common';
import { createAuth } from '@parkfairy/auth';
import type { Database } from '@parkfairy/database';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB } from '../database/database.module.js';
import { AuthGuard } from './auth.guard.js';
import { AUTH } from './auth.tokens.js';
import { OriginGuard } from './origin.guard.js';

/**
 * The API never issues sessions; the web app hosts the Better Auth handlers.
 * This module builds the same Better Auth instance purely to verify sessions.
 */
@Global()
@Module({
  providers: [
    {
      provide: AUTH,
      inject: [ENV, DB],
      useFactory: (env: Env, db: Database) =>
        createAuth({
          db,
          secret: env.BETTER_AUTH_SECRET,
          baseURL: env.BETTER_AUTH_URL,
          trustedOrigins: env.trustedOrigins,
        }),
    },
    AuthGuard,
    OriginGuard,
  ],
  exports: [AUTH, AuthGuard, OriginGuard],
})
export class AuthModule {}
