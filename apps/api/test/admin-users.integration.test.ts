import { randomUUID } from 'node:crypto';
import {
  ADMIN_IDENTITY_NOTE_MAX,
  AdminUserLookupResultSchema,
  AdminUserSchema,
  AuditLogSchema,
} from '@parkfairy/contracts';
import type { Auth } from '@parkfairy/auth';
import { claimDueEmails, releaseEmails, schema, type Database } from '@parkfairy/database';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH } from '../src/auth/auth.tokens.js';
import { DB } from '../src/database/database.module.js';
import { createTestApp, signUpUser, updateUser, type TestApp, type TestUser } from './test-app.js';

// Support's way into an account (5.2c, #13): find a person by their address, remove their second
// factor after an identity check.
const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin;
const PASSWORD = 'correct horse battery staple';
const later = () => new Date(Date.now() + 3_600_000);
const NOTE = 'Video call, ticket 4821.';

describe('support and accounts (5.2c: #13)', () => {
  let app: TestApp;
  let db: Database;
  const users: TestUser[] = [];
  const visitors = new Map<string, string>();

  const call = (
    user: TestUser | null,
    method: 'get' | 'post',
    path: string,
    origin: string | null = ORIGIN,
  ) => {
    const req = request(app.getHttpServer())[method](`/v1${path}`);
    if (method !== 'get' && origin) req.set('Origin', origin);
    if (!user) return req;
    let address = visitors.get(user.id);
    if (!address) {
      address = `198.72.${Math.floor(visitors.size / 250)}.${(visitors.size % 250) + 1}`;
      visitors.set(user.id, address);
    }
    return req.set('Cookie', user.cookie).set('X-Forwarded-For', address);
  };

  async function person(): Promise<TestUser> {
    const user = await signUpUser(app);
    users.push(user);
    return user;
  }
  async function staff(): Promise<TestUser> {
    const user = await person();
    await updateUser(app, user.id, { role: 'admin', twoFactorEnabled: true });
    return user;
  }
  /** An account with a second factor on, as Better Auth leaves it, and a session to lose. */
  async function secured(): Promise<TestUser> {
    const user = await person();
    await updateUser(app, user.id, { twoFactorEnabled: true });
    await db.insert(schema.twoFactors).values({
      userId: user.id,
      secret: `secret-${randomUUID()}`,
      backupCodes: 'codes',
    });
    return user;
  }

  const audited = (targetId: string) =>
    db
      .select({
        action: schema.auditLog.action,
        actorId: schema.auditLog.actorId,
        targetType: schema.auditLog.targetType,
        details: schema.auditLog.details,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, targetId));
  const mailed = (userId: string) =>
    db
      .select({ kind: schema.emailOutbox.kind, payload: schema.emailOutbox.payload })
      .from(schema.emailOutbox)
      .where(eq(schema.emailOutbox.userId, userId));

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
  });

  afterAll(async () => {
    // Staff who acted stay: the log restricts their accounts (#68), which is the point of it.
    const ids = users.map((user) => user.id);
    const acted = await db
      .select({ id: schema.auditLog.actorId })
      .from(schema.auditLog)
      .where(inArray(schema.auditLog.actorId, ids));
    const keep = new Set(acted.map((row) => row.id));
    const gone = ids.filter((id) => !keep.has(id));
    if (gone.length > 0) {
      await db.delete(schema.emailOutbox).where(inArray(schema.emailOutbox.userId, gone));
      await db.delete(schema.users).where(inArray(schema.users.id, gone));
    }
    await app.close();
  });

  describe('who may', () => {
    const paths = [
      ['post', '/admin/users/lookup'],
      ['get', `/admin/users/${randomUUID()}`],
      ['post', `/admin/users/${randomUUID()}/remove-two-factor`],
    ] as const;

    it.each(paths)('needs an account for %s %s', async (method, path) => {
      await call(null, method, path).send({ note: NOTE }).expect(401);
    });

    it.each(paths)('is not for an ordinary account: %s %s', async (method, path) => {
      const user = await person();
      await call(user, method, path).send({ note: NOTE }).expect(403);
    });

    it.each(paths)('needs a second factor of an admin: %s %s', async (method, path) => {
      const user = await person();
      await updateUser(app, user.id, { role: 'admin' });
      const response = await call(user, method, path).send({ note: NOTE }).expect(403);
      expect(response.body).toMatchObject({ code: 'MFA_REQUIRED' });
    });

    it('refuses a write from another site on its origin, and changes nothing', async () => {
      const admin = await staff();
      const target = await secured();
      await call(
        admin,
        'post',
        `/admin/users/${target.id}/remove-two-factor`,
        'https://evil.example',
      )
        .send({ note: NOTE })
        .expect(403);
      const [row] = await db
        .select({ on: schema.users.twoFactorEnabled })
        .from(schema.users)
        .where(eq(schema.users.id, target.id));
      expect(row?.on).toBe(true);
    });
  });

  describe('finding an account', () => {
    const lookUp = (admin: TestUser, body: unknown) =>
      call(admin, 'post', '/admin/users/lookup').send(body as object);
    const viewed = (id: string) =>
      audited(id).then((lines) => lines.filter((line) => line.action === 'user.viewed'));

    it('finds the id behind a whole address, in any case, and nothing else about it', async () => {
      const admin = await staff();
      const target = await secured();
      const response = await lookUp(admin, { email: ` ${target.email.toUpperCase()} ` }).expect(
        200,
      );
      expect(AdminUserLookupResultSchema.parse(response.body)).toEqual({ id: target.id });
      expect(response.headers['cache-control']).toContain('no-store');
      // The lookup shows an id only: opening the page is what is logged.
      expect(await viewed(target.id)).toEqual([]);
    });

    it('answers none for an address nobody has', async () => {
      const admin = await staff();
      const response = await lookUp(admin, { email: `nobody-${randomUUID()}@example.com` }).expect(
        200,
      );
      expect(response.body).toEqual({ id: null });
    });

    it('is never a search: part of an address, a pattern or a list is refused, not matched', async () => {
      const admin = await staff();
      const target = await person();
      const part = target.email.slice(0, target.email.indexOf('@'));
      for (const email of [part, '%@example.com', 'a@example.com, b@example.com', '', 42]) {
        const response = await lookUp(admin, { email }).expect(400);
        expect(response.body).toMatchObject({ statusCode: 400 });
      }
      await lookUp(admin, {}).expect(400);
      await lookUp(admin, { email: target.email, extra: true }).expect(400);
      await lookUp(admin, { email: [target.email, target.email] }).expect(400);
    });

    it('takes the address in the body: it is not read from the URL', async () => {
      const admin = await staff();
      const target = await person();
      await call(admin, 'post', `/admin/users/lookup?email=${encodeURIComponent(target.email)}`)
        .send({})
        .expect(400);
      // And there is no route that lists accounts.
      await call(admin, 'get', '/admin/users').expect(404);
    });

    it('is throttled per account: the 31st in a minute is refused, and another admin is not', async () => {
      const busy = await staff();
      const other = await staff();
      const email = `nobody-${randomUUID()}@example.com`;
      const answers: number[] = [];
      for (let i = 0; i < 31; i++) answers.push((await lookUp(busy, { email })).status);
      expect(answers.slice(0, 30).every((status) => status === 200)).toBe(true);
      expect(answers[30]).toBe(429);
      await lookUp(other, { email }).expect(200);
    });

    it('opens an account’s page, shows no secret, and logs who opened it', async () => {
      const admin = await staff();
      const target = await secured();
      const response = await call(admin, 'get', `/admin/users/${target.id}`).expect(200);
      expect(AdminUserSchema.parse(response.body)).toMatchObject({
        id: target.id,
        email: target.email,
        role: 'user',
        twoFactorEnabled: true,
        own: false,
        canRemoveTwoFactor: true,
      });
      expect(response.headers['cache-control']).toContain('no-store');
      const text = JSON.stringify(response.body);
      expect(text).not.toMatch(/secret|backup|password|token|session/i);
      expect(Object.keys(response.body as object).sort()).toEqual(
        Object.keys(AdminUserSchema.shape).sort(),
      );
      expect(await viewed(target.id)).toEqual([
        { action: 'user.viewed', actorId: admin.id, targetType: 'user', details: {} },
      ]);
    });

    it('logs each opening, and none for an account that is not there', async () => {
      const admin = await staff();
      const target = await person();
      await call(admin, 'get', `/admin/users/${target.id}`).expect(200);
      await call(admin, 'get', `/admin/users/${target.id}`).expect(200);
      expect(await viewed(target.id)).toHaveLength(2);
      const missing = randomUUID();
      await call(admin, 'get', `/admin/users/${missing}`).expect(404);
      expect(await audited(missing)).toEqual([]);
    });

    it('is not for a link on another site: a page that logs is refused its cross-site navigation', async () => {
      const admin = await staff();
      const target = await person();
      for (const site of ['cross-site', 'same-site']) {
        await call(admin, 'get', `/admin/users/${target.id}`)
          .set('Sec-Fetch-Site', site)
          .expect(403);
      }
      await call(admin, 'get', `/admin/users/${target.id}`)
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(200);
      expect(await viewed(target.id)).toHaveLength(1);
    });

    it('knows the reader’s own account and another staff member’s, and offers no removal on them', async () => {
      const admin = await staff();
      const colleague = await staff();
      const own = await call(admin, 'get', `/admin/users/${admin.id}`).expect(200);
      expect(own.body).toMatchObject({ own: true, canRemoveTwoFactor: false });
      const other = await call(admin, 'get', `/admin/users/${colleague.id}`).expect(200);
      expect(other.body).toMatchObject({ own: false, role: 'admin', canRemoveTwoFactor: false });
    });

    it('offers no removal on an account without a second factor', async () => {
      const admin = await staff();
      const target = await person();
      const response = await call(admin, 'get', `/admin/users/${target.id}`).expect(200);
      expect(response.body).toMatchObject({ twoFactorEnabled: false, canRemoveTwoFactor: false });
    });

    it('answers 404 for an id that is not one, or that nobody has', async () => {
      const admin = await staff();
      for (const id of ['not-an-id', randomUUID()]) {
        const response = await call(admin, 'get', `/admin/users/${id}`).expect(404);
        expect(response.body).toMatchObject({ code: 'USER_NOT_FOUND' });
      }
    });
  });

  describe('removing a second factor (#13)', () => {
    const remove = (admin: TestUser, id: string, body: unknown = { note: NOTE }) =>
      call(admin, 'post', `/admin/users/${id}/remove-two-factor`).send(body as object);

    it('takes it off, ends every session, emails the address and writes the note to the log', async () => {
      const admin = await staff();
      const target = await secured();
      // A second session, as on another device.
      const other = await signUpUserAgain(target);
      const response = await remove(admin, target.id).expect(200);
      expect(AdminUserSchema.parse(response.body)).toMatchObject({
        id: target.id,
        twoFactorEnabled: false,
        canRemoveTwoFactor: false,
      });

      expect(
        await db.select().from(schema.twoFactors).where(eq(schema.twoFactors.userId, target.id)),
      ).toEqual([]);
      expect(
        await db.select().from(schema.sessions).where(eq(schema.sessions.userId, target.id)),
      ).toEqual([]);
      // Both sessions are gone: the API no longer knows either.
      await call(target, 'get', '/me').expect(401);
      await call(other, 'get', '/me').expect(401);

      expect(await mailed(target.id)).toEqual([{ kind: 'two-factor-removed', payload: {} }]);
      expect(await audited(target.id)).toEqual([
        {
          action: 'user.two_factor_removed',
          actorId: admin.id,
          targetType: 'user',
          details: { note: NOTE, sessionsEnded: 2, passwordRevoked: true },
        },
      ]);
    });

    it('shows the removal in the log, filtered by its action, as a removal done to a user', async () => {
      const admin = await staff();
      const target = await secured();
      await remove(admin, target.id).expect(200);
      const log = AuditLogSchema.parse(
        (await call(admin, 'get', '/admin/audit?action=user.two_factor_removed').expect(200)).body,
      );
      const line = log.entries.find((entry) => entry.targetId === target.id);
      expect(line).toMatchObject({
        action: 'user.two_factor_removed',
        targetType: 'user',
        actor: { id: admin.id },
        details: { note: NOTE },
      });
    });

    it('touches no one else: another account’s factor and sessions, and the admin’s own, stay', async () => {
      const admin = await staff();
      const target = await secured();
      const bystander = await secured();
      await remove(admin, target.id).expect(200);
      expect(
        await db.select().from(schema.twoFactors).where(eq(schema.twoFactors.userId, bystander.id)),
      ).toHaveLength(1);
      const [still] = await db
        .select({ on: schema.users.twoFactorEnabled })
        .from(schema.users)
        .where(eq(schema.users.id, bystander.id));
      expect(still?.on).toBe(true);
      await call(bystander, 'get', '/me').expect(200);
      await call(admin, 'get', '/me').expect(200);
      const [credential] = await db
        .select({ password: schema.accounts.password })
        .from(schema.accounts)
        .where(eq(schema.accounts.userId, bystander.id));
      expect(credential?.password).toBeTruthy();
      expect(await mailed(bystander.id)).toEqual([]);
    });

    it('queues an email the worker can address: the account’s own address, in its language', async () => {
      const admin = await staff();
      const target = await secured();
      await updateUser(app, target.id, { locale: 'el' });
      await remove(admin, target.id).expect(200);
      const claimed = await claimDueEmails(db, 500);
      const ours = claimed.find(
        (email) => email.kind === 'two-factor-removed' && email.to === target.email,
      );
      expect(ours).toMatchObject({ to: target.email, locale: 'el', inviteId: null });
      await releaseEmails(db, claimed);
    });

    it('revokes the password and the links and devices it allowed, and the emailed reset gets the person back in', async () => {
      const admin = await staff();
      const target = await secured();
      // A reset link and a trusted device from before: what the password's holder had.
      await db.insert(schema.verifications).values([
        { identifier: `reset-password:old-${randomUUID()}`, value: target.id, expiresAt: later() },
        { identifier: `trust-device:old-${randomUUID()}`, value: target.id, expiresAt: later() },
      ]);
      await remove(admin, target.id).expect(200);
      expect(
        await db
          .select()
          .from(schema.verifications)
          .where(eq(schema.verifications.value, target.id)),
      ).toEqual([]);
      const [credential] = await db
        .select({ password: schema.accounts.password })
        .from(schema.accounts)
        .where(eq(schema.accounts.userId, target.id));
      expect(credential?.password).toBeNull();
      // The old password opens nothing.
      const auth = app.get<Auth>(AUTH);
      const refused = await auth.api.signInEmail({
        body: { email: target.email, password: PASSWORD },
        asResponse: true,
      });
      expect(refused.ok).toBe(false);
      // A reset, as the person asks for one, sets a new password, and that opens the account.
      const token = `fresh-${randomUUID()}`;
      await db.insert(schema.verifications).values({
        identifier: `reset-password:${token}`,
        value: target.id,
        expiresAt: later(),
      });
      await auth.api.resetPassword({ body: { token, newPassword: 'a brand new password 1' } });
      const back = await auth.api.signInEmail({
        body: { email: target.email, password: 'a brand new password 1' },
        asResponse: true,
      });
      expect(back.ok).toBe(true);
    });

    it('is done once: the second try finds nothing to remove, and no second email or line', async () => {
      const admin = await staff();
      const target = await secured();
      await remove(admin, target.id).expect(200);
      const second = await remove(admin, target.id).expect(409);
      expect(second.body).toMatchObject({ code: 'NO_TWO_FACTOR' });
      expect(await mailed(target.id)).toHaveLength(1);
      expect(await audited(target.id)).toHaveLength(1);
    });

    it('is done once when several admins press at the same moment', async () => {
      const admins = await Promise.all(Array.from({ length: 5 }, () => staff()));
      const target = await secured();
      const answers = await Promise.all(admins.map((admin) => remove(admin, target.id)));
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409, 409, 409, 409]);
      expect(await mailed(target.id)).toHaveLength(1);
      expect(await audited(target.id)).toHaveLength(1);
    });

    it('is throttled to a few a minute per admin, so a stolen session can’t strip many accounts', async () => {
      const busy = await staff();
      const other = await staff();
      const none = randomUUID();
      const answers: number[] = [];
      for (let i = 0; i < 6; i++) answers.push((await remove(busy, none)).status);
      expect(answers.slice(0, 5).every((status) => status === 404)).toBe(true);
      expect(answers[5]).toBe(429);
      await remove(other, none).expect(404);
    });

    it('removes it from an account whose address was never confirmed, and still emails it', async () => {
      const admin = await staff();
      const target = await secured();
      await updateUser(app, target.id, { emailVerified: false });
      await remove(admin, target.id).expect(200);
      expect(await mailed(target.id)).toHaveLength(1);
    });

    it('leaves a flag with no factor behind it, or a factor with no flag, as it found it', async () => {
      const admin = await staff();
      // The flag is on but nothing stands behind it: removing clears the flag all the same.
      const flagOnly = await person();
      await updateUser(app, flagOnly.id, { twoFactorEnabled: true });
      await remove(admin, flagOnly.id).expect(200);
      // A factor with the flag off is an unfinished enrolment: nothing to remove, and nothing orphaned.
      const factorOnly = await person();
      await db.insert(schema.twoFactors).values({
        userId: factorOnly.id,
        secret: `secret-${randomUUID()}`,
        backupCodes: 'codes',
      });
      await remove(admin, factorOnly.id).expect(409);
      expect(await mailed(factorOnly.id)).toEqual([]);
      expect(await audited(factorOnly.id)).toEqual([]);
    });

    it('is refused for an account without one, with nothing recorded', async () => {
      const admin = await staff();
      const target = await person();
      const response = await remove(admin, target.id).expect(409);
      expect(response.body).toMatchObject({ code: 'NO_TWO_FACTOR' });
      expect(await audited(target.id)).toEqual([]);
      expect(await mailed(target.id)).toEqual([]);
    });

    it('is refused on the admin’s own account', async () => {
      const admin = await staff();
      const response = await remove(admin, admin.id).expect(403);
      expect(response.body).toMatchObject({ code: 'OWN_ACCOUNT' });
      expect(await audited(admin.id)).toEqual([]);
    });

    it('is refused on another staff member’s: staff are recovered by hand', async () => {
      const admin = await staff();
      const colleague = await staff();
      await db.insert(schema.twoFactors).values({
        userId: colleague.id,
        secret: `secret-${randomUUID()}`,
        backupCodes: 'codes',
      });
      const response = await remove(admin, colleague.id).expect(403);
      expect(response.body).toMatchObject({ code: 'STAFF_ACCOUNT' });
      const [row] = await db
        .select({ on: schema.users.twoFactorEnabled })
        .from(schema.users)
        .where(eq(schema.users.id, colleague.id));
      expect(row?.on).toBe(true);
      expect(await audited(colleague.id)).toEqual([]);
      await call(colleague, 'get', '/admin/audit').expect(200);
    });

    it('answers 404 for an account that does not exist', async () => {
      const admin = await staff();
      for (const id of ['not-an-id', randomUUID()]) {
        const response = await remove(admin, id).expect(404);
        expect(response.body).toMatchObject({ code: 'USER_NOT_FOUND' });
      }
    });

    it('wants a note on how the person was identified, in plain words', async () => {
      // The route is throttled to a few a minute, refusals included: a new admin for each few.
      let admin = await staff();
      let asked = 0;
      const ask = async (body: object) => {
        if (asked++ % 4 === 3) admin = await staff();
        return (await remove(admin, target.id, body)).status;
      };
      const target = await secured();
      const hidden = [0x0, 0xad, 0x202e, 0x61c, 0x2028, 0x2060].map(
        (point) => `a${String.fromCodePoint(point)}b`,
      );
      for (const note of [
        undefined,
        '',
        '   ',
        'x'.repeat(ADMIN_IDENTITY_NOTE_MAX + 1),
        ...hidden,
        42,
      ]) {
        expect(await ask({ note })).toBe(400);
      }
      expect(await ask({ note: NOTE, extra: true })).toBe(400);
      expect(await audited(target.id)).toEqual([]);
      const [row] = await db
        .select({ on: schema.users.twoFactorEnabled })
        .from(schema.users)
        .where(eq(schema.users.id, target.id));
      expect(row?.on).toBe(true);
    });

    it('keeps the note, trimmed, as written', async () => {
      const admin = await staff();
      const target = await secured();
      await remove(admin, target.id, { note: `  ${NOTE}  ` }).expect(200);
      expect((await audited(target.id))[0]?.details).toMatchObject({ note: NOTE });
    });

    it('changes nothing when the log cannot be written', async () => {
      const admin = await staff();
      const target = await secured();
      // A line the log's own check refuses, as a fault in the middle of the transaction would.
      const refusal = `it_refuse_${target.id.slice(0, 8)}`;
      await db.execute(
        sql.raw(
          `alter table audit_log add constraint ${refusal} check (target_id <> '${target.id}') not valid`,
        ),
      );
      try {
        await remove(admin, target.id).expect(500);
      } finally {
        await db.execute(sql.raw(`alter table audit_log drop constraint ${refusal}`));
      }
      const [row] = await db
        .select({ on: schema.users.twoFactorEnabled })
        .from(schema.users)
        .where(eq(schema.users.id, target.id));
      expect(row?.on).toBe(true);
      expect(
        await db.select().from(schema.twoFactors).where(eq(schema.twoFactors.userId, target.id)),
      ).toHaveLength(1);
      expect(await mailed(target.id)).toEqual([]);
      // The session survived too: the rollback undid the deletion.
      await call(target, 'get', '/me').expect(200);
    });
  });

  /** Another session for the same account, as signing in on a second device makes. */
  async function signInAgain(user: TestUser): Promise<TestUser> {
    const auth = app.get<Auth>(AUTH);
    const response = await auth.api.signInEmail({
      body: { email: user.email, password: 'correct horse battery staple' },
      asResponse: true,
    });
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    return { ...user, cookie };
  }
  async function signUpUserAgain(user: TestUser): Promise<TestUser> {
    // `secured` set the flag directly, so Better Auth does not ask this account for a code.
    await updateUser(app, user.id, { twoFactorEnabled: false });
    const again = await signInAgain(user);
    await updateUser(app, user.id, { twoFactorEnabled: true });
    return again;
  }
});
