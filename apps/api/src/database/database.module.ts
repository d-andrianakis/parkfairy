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
        createDatabase({ connectionString: env.DATABASE_URL, applicationName: 'parkfairy-api' }),
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
