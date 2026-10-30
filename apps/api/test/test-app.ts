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

const PASSWORD = 'correct horse battery staple';

/**
 * Signs up a fresh user through Better Auth, exactly as the web app's handler would, confirms
 * the address (as following the emailed link does) and signs in.
 */
export async function signUpUser(app: INestApplication): Promise<TestUser> {
  const auth = app.get<Auth>(AUTH);
  const email = `test-${randomUUID()}@example.com`;
  const signedUp = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: 'Test Driver' },
    asResponse: true,
  });
  if (!signedUp.ok) {
    throw new Error(`Sign-up failed with ${signedUp.status}: ${await signedUp.text()}`);
  }
  const { user } = (await signedUp.json()) as { user: { id: string } };
  await updateUser(app, user.id, { emailVerified: true });
  const response = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  });
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
