import { createHmac } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import type { Auth } from '@parkfairy/auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Roles } from '../src/auth/auth.decorators.js';
import { AUTH } from '../src/auth/auth.tokens.js';
import { createTestApp, signUpUser, updateUser, type TestApp } from './test-app.js';

const PASSWORD = 'correct horse battery staple'; // signUpUser's

@Controller('mfa-probe')
class MfaProbeController {
  @Get('admin')
  @Roles('admin')
  admin() {
    return { ok: true };
  }
}

/** The current TOTP for an otpauth:// URI (RFC 6238: SHA-1, 30 s, 6 digits). */
function totp(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
  let bits = 0;
  let value = 0;
  const key: number[] = [];
  for (const char of secret) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      key.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac('sha1', Buffer.from(key)).update(counter).digest();
  const offset = (hash.at(-1) ?? 0) & 0x0f;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
const headers = (cookie: string) => new Headers({ cookie });

describe('two-factor changes (Better Auth, end to end)', () => {
  let app: TestApp;
  let auth: Auth;

  beforeAll(async () => {
    app = await createTestApp([MfaProbeController]);
    auth = app.get<Auth>(AUTH);
  });
  afterAll(async () => {
    await app.close();
  });

  const signIn = async (email: string) =>
    auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
  const status = async (path: string, cookie: string) =>
    (await request(app.getHttpServer()).get(path).set('Cookie', cookie)).status;

  async function enrol(cookie: string) {
    const enabled = (await auth.api.enableTwoFactor({
      body: { password: PASSWORD },
      headers: headers(cookie),
    })) as { totpURI: string; backupCodes: string[] };
    const verified = await auth.api.verifyTOTP({
      body: { code: totp(enabled.totpURI) },
      headers: headers(cookie),
      asResponse: true,
    });
    expect(verified.ok).toBe(true);
    return { ...enabled, cookie: cookieOf(verified) };
  }

  it('unlocks admin routes only once a code is verified, and ends every other session', async () => {
    const admin = await signUpUser(app);
    await updateUser(app, admin.id, { role: 'admin' });
    const otherDevice = cookieOf(await signIn(admin.email));

    // Enabling alone (no verified code) changes nothing.
    await auth.api.enableTwoFactor({
      body: { password: PASSWORD },
      headers: headers(admin.cookie),
    });
    const pending = await request(app.getHttpServer())
      .get('/v1/mfa-probe/admin')
      .set('Cookie', admin.cookie);
    expect(pending.status).toBe(403);
    expect(pending.body).toMatchObject({ code: 'MFA_REQUIRED' });

    const enrolled = await enrol(admin.cookie);
    expect(await status('/v1/mfa-probe/admin', enrolled.cookie)).toBe(200);
    // A session that never passed the second factor must not inherit the new flag.
    expect(await status('/v1/me', otherDevice)).toBe(401);
    expect(await status('/v1/me', admin.cookie)).toBe(401); // replaced
  });

  it('turning it off asks for the password and also ends every other session', async () => {
    const user = await signUpUser(app);
    const { cookie } = await enrol(user.cookie);

    await expect(
      auth.api.disableTwoFactor({ body: { password: 'wrong password' }, headers: headers(cookie) }),
    ).rejects.toMatchObject({ body: { code: 'INVALID_PASSWORD' } });

    const signedIn = await signIn(user.email); // two-factor challenge, not a session yet
    expect(await status('/v1/me', cookieOf(signedIn))).toBe(401);

    const disabled = await auth.api.disableTwoFactor({
      body: { password: PASSWORD },
      headers: headers(cookie),
      asResponse: true,
    });
    expect(disabled.ok).toBe(true);
    expect(await status('/v1/me', cookieOf(disabled))).toBe(200);
    expect(await status('/v1/me', cookie)).toBe(401);
  });

  it('a backup code signs in once, and a two-factor sign-in leaves other devices alone', async () => {
    const user = await signUpUser(app);
    const { backupCodes, cookie } = await enrol(user.cookie);
    const [code] = backupCodes;

    const challenge = cookieOf(await signIn(user.email));
    const verified = await auth.api.verifyBackupCode({
      body: { code: code ?? '' },
      headers: headers(challenge),
      asResponse: true,
    });
    expect(verified.ok).toBe(true);
    expect(await status('/v1/me', cookieOf(verified))).toBe(200);
    expect(await status('/v1/me', cookie)).toBe(200); // the enrolling device stays signed in

    const again = cookieOf(await signIn(user.email));
    const reused = await auth.api.verifyBackupCode({
      body: { code: code ?? '' },
      headers: headers(again),
      asResponse: true,
    });
    expect(reused.ok).toBe(false);
  });
});
