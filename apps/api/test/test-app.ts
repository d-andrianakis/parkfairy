import { randomUUID } from 'node:crypto';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Auth } from '@parkfairy/auth';
import { schema, type Database } from '@parkfairy/database';
import { eq } from 'drizzle-orm';
import type request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AUTH } from '../src/auth/auth.tokens.js';
import { DB } from '../src/database/database.module.js';

export type TestApp = INestApplication<Parameters<typeof request>[0]>;

export async function createTestApp(extraControllers: Type[] = []): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  }).compile();
  const app = moduleRef.createNestApplication<TestApp>({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export interface TestUser {
  id: string;
  email: string;
  /** `Cookie` header value carrying the session. */
  cookie: string;
}

/** Signs up a fresh user through Better Auth, exactly as the web app's handler would. */
export async function signUpUser(app: INestApplication): Promise<TestUser> {
  const auth = app.get<Auth>(AUTH);
  const email = `test-${randomUUID()}@example.com`;
  const response = await auth.api.signUpEmail({
    body: { email, password: 'correct horse battery staple', name: 'Test Driver' },
    asResponse: true,
  });
  if (!response.ok) {
    throw new Error(`Sign-up failed with ${response.status}: ${await response.text()}`);
  }
  const { user } = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { id: user.id, email, cookie };
}

export async function updateUser(
  app: INestApplication,
  userId: string,
  values: Partial<typeof schema.users.$inferInsert>,
): Promise<void> {
  const db = app.get<Database>(DB);
  await db.update(schema.users).set(values).where(eq(schema.users.id, userId));
}
