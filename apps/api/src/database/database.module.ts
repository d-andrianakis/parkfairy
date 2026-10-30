import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type DatabaseConnection } from '@parkfairy/database';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export const DB_CONNECTION = Symbol('DB_CONNECTION');
/** Injection token for the Drizzle `Database` instance. */
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      inject: [ENV],
      useFactory: (env: Env) =>
        createDatabase({
          connectionString: env.DATABASE_URL,
          applicationName: 'parkfairy-api',
          // Public search must never hold a connection for long.
          // Below the web app's 4 s request timeout, so work is not done for nobody.
          statementTimeoutMs: 3000,
          // Under load, fail fast rather than queue past the web app's 4 s timeout.
          connectionTimeoutMs: 2000,
        }),
    },
    {
      provide: DB,
      inject: [DB_CONNECTION],
      useFactory: (connection: DatabaseConnection) => connection.db,
    },
  ],
  exports: [DB, DB_CONNECTION],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_CONNECTION) private readonly connection: DatabaseConnection) {}

  async onApplicationShutdown() {
    await this.connection.close();
  }
}
