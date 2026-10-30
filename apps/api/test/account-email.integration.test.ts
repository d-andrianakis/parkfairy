import { randomUUID } from 'node:crypto';
import { createAuth, type AuthEmail } from '@parkfairy/auth';
import { deleteUnconfirmedAccounts, schema, type Database } from '@parkfairy/database';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from '../src/database/database.module.js';
import { createTestApp, updateUser, type TestApp } from './test-app.js';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a much better horse staple';

/** The session a response hands out, if any; an emptied cookie (clearing one) doesn't count. */
const sessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .filter((cookie) => /session_token=[^;]/.test(cookie))
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

/** Better Auth through its HTTP handler, as the web app's route does. */
describe('account emails (Better Auth and Postgres, end to end)', () => {
  let app: TestApp;
  let db: Database;
  let handler: (request: Request) => Promise<Response>;
  let sent: AuthEmail[];

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Database>(DB);
    handler = createAuth({
      db,
      secret: 'x'.repeat(32),
      baseURL: ORIGIN,
      trustedOrigins: [ORIGIN],
      sendEmail: (email) => sent.push(email),
    }).handler;
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    sent = [];
  });

  const post = (path: string, body: unknown, cookie?: string) =>
    handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const follow = (url: string) => handler(new Request(url, { redirect: 'manual' }));
  const signUp = (email: string, locale = 'el') =>
    post('/sign-up/email', { name: 'Maria', email, password: PASSWORD, locale });
  const signIn = (email: string, password = PASSWORD) =>
    post('/sign-in/email', { email, password });
  const newAddress = () => `email-${randomUUID()}@example.com`;
  const lastEmail = () => sent.at(-1) as AuthEmail;
  /** What the button on the emailed link's page does. */
  const confirm = ({ url }: AuthEmail) =>
    handler(
      new Request(
        `${ORIGIN}/api/auth/verify-email?token=${new URL(url).searchParams.get('token') ?? ''}`,
      ),
    );

  /** A fresh account with a confirmed address. */
  async function confirmedAccount(locale = 'en') {
    const email = newAddress();
    await signUp(email, locale);
    await confirm(lastEmail());
    sent = [];
    return email;
  }

  async function userId(email: string) {
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return user?.id ?? '';
  }

  describe('confirming an address', () => {
    it('opens no session at sign-up and writes in the language the account chose', async () => {
      const email = newAddress();
      const response = await signUp(email, 'en');

      expect(response.status).toBe(200);
      expect(sessionCookie(response)).toBe('');
      // Exactly these fields: the name is free text, and a stranger may have chosen it.
      expect(sent).toHaveLength(1);
      const { url, ...rest } = sent[0] as AuthEmail;
      expect(rest).toEqual({ kind: 'verify-email', to: email, locale: 'en' });
      expect(url.startsWith(`${ORIGIN}/en/verify-email?token=`)).toBe(true);
      expect(url).toMatch(/\?token=[\w.-]+$/);
    });

    it('refuses sign-in until confirmed, and only after the right password', async () => {
      const email = newAddress();
      await signUp(email, 'en'); // not the default language: a lost locale would show
      sent = [];

      expect((await signIn(email, 'not the password')).status).toBe(401);
      expect(sent).toEqual([]); // a stranger cannot trigger mail, nor learn the account exists

      const refused = await signIn(email);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(sessionCookie(refused)).toBe('');
      expect(lastEmail()).toMatchObject({ kind: 'verify-email', to: email, locale: 'en' });
    });

    it('confirms with the token from the link, opening no session, then allows sign-in', async () => {
      const email = newAddress();
      await signUp(email, 'en');

      const confirmed = await confirm(lastEmail());
      expect(confirmed.status).toBe(200);
      // Someone else may have signed up with this address and know the password.
      expect(sessionCookie(confirmed)).toBe('');

      const [user] = await db
        .select({ emailVerified: schema.users.emailVerified })
        .from(schema.users)
        .where(eq(schema.users.email, email));
      expect(user?.emailVerified).toBe(true);
      const signedIn = await signIn(email);
      expect(signedIn.status).toBe(200);
      expect(sessionCookie(signedIn)).not.toBe('');
    });

    it('can confirm twice, as a person double-clicking would', async () => {
      await signUp(newAddress());
      const email = lastEmail();
      expect((await confirm(email)).status).toBe(200);
      expect((await confirm(email)).status).toBe(200);
    });

    it('refuses a damaged token, confirming nothing', async () => {
      const email = newAddress();
      await signUp(email, 'en');
      const damaged = new URL(lastEmail().url);
      damaged.searchParams.set('token', `${damaged.searchParams.get('token') ?? ''}x`);

      const answer = await confirm({ ...lastEmail(), url: damaged.href });

      expect(answer.status).toBe(401);
      expect(await answer.json()).toMatchObject({ code: 'INVALID_TOKEN' });
      expect((await signIn(email)).status).toBe(403);
    });

    describe('after a while', () => {
      afterEach(() => {
        vi.useRealTimers();
      });
      const later = (hours: number) => {
        vi.useFakeTimers({ now: Date.now() + hours * 60 * 60 * 1000, toFake: ['Date'] });
      };

      it('still confirms within the 24 hours the email promises', async () => {
        await signUp(newAddress());
        later(23);
        expect((await confirm(lastEmail())).status).toBe(200);
      });

      it('refuses the link after them', async () => {
        await signUp(newAddress());
        later(25);
        const answer = await confirm(lastEmail());
        expect(answer.status).toBe(401);
        expect(await answer.json()).toMatchObject({ code: 'TOKEN_EXPIRED' });
      });
    });

    it('builds its own link whatever callback a request names', async () => {
      const email = newAddress();
      await signUp(email, 'en');
      sent = [];

      await post('/send-verification-email', { email, callbackURL: 'https://evil.example/' });

      const link = new URL(lastEmail().url);
      expect(link.origin).toBe(ORIGIN);
      expect(link.pathname).toBe('/en/verify-email');
      expect(link.searchParams.has('callbackURL')).toBe(false);
    });

    it('says nothing about whether an address needs confirming', async () => {
      const unconfirmed = newAddress();
      await signUp(unconfirmed);
      sent = [];

      const answers = await Promise.all(
        [unconfirmed, await confirmedAccount(), newAddress()].map((email) =>
          post('/send-verification-email', { email }),
        ),
      );

      for (const answer of answers) {
        expect(answer.status).toBe(200);
        expect(await answer.json()).toEqual({ status: true });
      }
      expect(sent.map((email) => email.to)).toEqual([unconfirmed]);
    });
  });

  describe('signing up with a taken address', () => {
    it('answers exactly like a new sign-up and tells the owner instead', async () => {
      const taken = await confirmedAccount('en');

      const fresh = (await (await signUp(newAddress())).json()) as { user: object };
      sent = [];
      const duplicate = await signUp(taken, 'el');
      const body = (await duplicate.json()) as { token: null; user: object };

      expect(duplicate.status).toBe(200);
      expect(sessionCookie(duplicate)).toBe('');
      expect(body.token).toBeNull();
      expect(Object.keys(body.user).sort()).toEqual(Object.keys(fresh.user).sort());
      // The owner's language, not the one the stranger asked for.
      expect(sent).toEqual([
        {
          kind: 'existing-account',
          to: taken,
          locale: 'en',
          url: `${ORIGIN}/en/forgot-password`,
        },
      ]);
    });

    it.each([
      ['an unsupported language', { locale: 'xx' }, 'INVALID_LOCALE'],
      ['a short password', { password: 'short' }, 'PASSWORD_TOO_SHORT'],
      ['a NUL in the name', { name: 'Ma\u0000ria' }, 'INVALID_SIGN_UP'],
      ['a name over the limit', { name: 'x'.repeat(101) }, 'INVALID_SIGN_UP'],
      ['an image, which the form never sends', { image: 'x' }, 'INVALID_SIGN_UP'],
    ])('refuses %s alike for taken and free addresses', async (_, input, code) => {
      const taken = await confirmedAccount();
      sent = [];

      const answers = await Promise.all(
        [taken, newAddress()].map((email) =>
          post('/sign-up/email', { name: 'Maria', email, password: PASSWORD, ...input }),
        ),
      );

      for (const answer of answers) {
        expect(answer.status).toBe(400);
        expect(await answer.json()).toMatchObject({ code });
      }
      expect(sent).toEqual([]);
    });

    it('does not let a stranger overwrite the account language', async () => {
      const taken = await confirmedAccount('en');
      await signUp(taken, 'el');
      const [user] = await db
        .select({ locale: schema.users.locale })
        .from(schema.users)
        .where(eq(schema.users.email, taken));
      expect(user?.locale).toBe('en');
    });
  });

  describe('resetting a password', () => {
    const requestReset = (email: string) => post('/request-password-reset', { email });

    async function resetToken(email: string) {
      await requestReset(email);
      const landed = await follow(lastEmail().url);
      const location = new URL(landed.headers.get('location') ?? '', ORIGIN);
      expect(location.pathname).toMatch(/^\/(el|en)\/reset-password$/);
      return location.searchParams.get('token') ?? '';
    }

    it('answers alike for known and unknown addresses, emailing only the known one', async () => {
      const email = await confirmedAccount();

      const unknown = await requestReset(newAddress());
      expect(sent).toEqual([]);
      const known = await requestReset(email);

      expect(unknown.status).toBe(known.status);
      expect(await unknown.json()).toEqual(await known.json());
      expect(sent).toEqual([expect.objectContaining({ kind: 'reset-password', to: email })]);
    });

    it('never stores the token in a usable form', async () => {
      const email = await confirmedAccount();
      const token = await resetToken(email);

      const rows = await db
        .select({ identifier: schema.verifications.identifier })
        .from(schema.verifications)
        .where(eq(schema.verifications.value, await userId(email)));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.identifier).not.toContain(token);
    });

    it('replaces the password, ends every session and tells the owner', async () => {
      const email = await confirmedAccount('en');
      const cookie = sessionCookie(await signIn(email));
      const token = await resetToken(email);
      sent = [];

      const reset = await post('/reset-password', { token, newPassword: NEW_PASSWORD });

      expect(reset.status).toBe(200);
      expect(sessionCookie(reset)).toBe(''); // the link alone is no session
      const session = await handler(
        new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie } }),
      );
      expect(await session.json()).toBeNull();
      expect((await signIn(email)).status).toBe(401);
      expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);
      expect(sent).toEqual([
        {
          kind: 'password-changed',
          to: email,
          locale: 'en',
          url: `${ORIGIN}/en/forgot-password`,
        },
      ]);
    });

    it('ends every other link too: a thief’s saved one must not undo the recovery', async () => {
      const email = await confirmedAccount();
      const saved = await resetToken(email);
      const used = await resetToken(email);

      await post('/reset-password', { token: used, newPassword: NEW_PASSWORD });
      const again = await post('/reset-password', { token: saved, newPassword: PASSWORD });

      expect(again.status).toBe(400);
      expect(await again.json()).toMatchObject({ code: 'INVALID_TOKEN' });
      expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);
    });

    it('leaves a link alone when another is requested, so nobody can kill a victim’s', async () => {
      const email = await confirmedAccount();
      const first = await resetToken(email);
      await resetToken(email);

      const reset = await post('/reset-password', { token: first, newPassword: NEW_PASSWORD });

      expect(reset.status).toBe(200);
    });

    it('refuses an expired link at both steps', async () => {
      const email = await confirmedAccount('en');
      const token = await resetToken(email);
      await db
        .update(schema.verifications)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.verifications.value, await userId(email)));

      const landed = await follow(lastEmail().url);
      expect(landed.headers.get('location')).toContain('error=INVALID_TOKEN');
      const reset = await post('/reset-password', { token, newPassword: NEW_PASSWORD });
      expect(reset.status).toBe(400);
      expect((await signIn(email)).status).toBe(200); // the old password still stands
    });

    it('leaves an unconfirmed account unconfirmed', async () => {
      const email = newAddress();
      await signUp(email);
      const token = await resetToken(email);

      await post('/reset-password', { token, newPassword: NEW_PASSWORD });

      expect((await signIn(email, NEW_PASSWORD)).status).toBe(403);
    });

    it('accepts a token only once', async () => {
      const email = await confirmedAccount();
      const token = await resetToken(email);

      await post('/reset-password', { token, newPassword: NEW_PASSWORD });
      const again = await post('/reset-password', { token, newPassword: PASSWORD });

      expect(again.status).toBe(400);
      expect(await again.json()).toMatchObject({ code: 'INVALID_TOKEN' });
      expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);
    });

    it('sends a dead link to the page with an error instead of a form', async () => {
      await requestReset(await confirmedAccount('en'));
      const dead = new URL(lastEmail().url);
      dead.pathname = '/api/auth/reset-password/no-such-token';

      const landed = await follow(dead.href);

      const location = new URL(landed.headers.get('location') ?? '', ORIGIN);
      expect(location.pathname).toBe('/en/reset-password');
      expect(location.searchParams.get('error')).toBe('INVALID_TOKEN');
      expect(location.searchParams.has('token')).toBe(false);
    });

    it('applies the password policy to the new password', async () => {
      const token = await resetToken(await confirmedAccount());
      const response = await post('/reset-password', { token, newPassword: 'short' });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
    });

    it('does not get around two-factor authentication', async () => {
      const email = await confirmedAccount();
      await updateUser(app, await userId(email), { twoFactorEnabled: true });
      const token = await resetToken(email);

      await post('/reset-password', { token, newPassword: NEW_PASSWORD });
      const response = await signIn(email, NEW_PASSWORD);

      expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
      expect(sessionCookie(response)).toBe('');
    });
  });

  describe('removing accounts never confirmed', () => {
    const DAY = 24 * 60 * 60 * 1000;

    it('removes them past the cut-off, with their credentials, and nothing else', async () => {
      const stale = newAddress();
      const fresh = newAddress();
      await signUp(stale);
      await signUp(fresh);
      const confirmed = await confirmedAccount();
      const old = new Date(Date.now() - 8 * DAY);
      const staleId = await userId(stale);
      await updateUser(app, staleId, { createdAt: old });
      await updateUser(app, await userId(confirmed), { createdAt: old });

      const deleted = await deleteUnconfirmedAccounts(db, new Date(Date.now() - 7 * DAY));

      expect(deleted).toBeGreaterThanOrEqual(1);
      expect(await userId(stale)).toBe('');
      expect(await userId(fresh)).not.toBe('');
      expect(await userId(confirmed)).not.toBe('');
      const accounts = await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.userId, staleId));
      expect(accounts).toEqual([]);
    });
  });
});
