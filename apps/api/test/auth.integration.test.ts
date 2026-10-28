import { Controller, Get, Post } from '@nestjs/common';
import type { Auth } from '@parkfairy/auth';
import { MeResponseSchema } from '@parkfairy/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Roles } from '../src/auth/auth.decorators.js';
import { AUTH } from '../src/auth/auth.tokens.js';
import { createTestApp, signUpUser, updateUser, type TestApp } from './test-app.js';

const TRUSTED_ORIGIN = 'http://localhost:3000';

@Controller('guard-probe')
class GuardProbeController {
  @Get('admin')
  @Roles('admin')
  admin() {
    return { ok: true };
  }

  @Post('mutate')
  mutate() {
    return { ok: true };
  }
}

describe('session verification across the web/API boundary', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp([GuardProbeController]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves liveness and readiness without a session', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200, { status: 'ok', checks: { database: 'up' } });
  });

  it('rejects protected endpoints without a session', async () => {
    await request(app.getHttpServer()).get('/v1/me').expect(401);
  });

  it('returns the verified user for a valid Better Auth session cookie', async () => {
    const user = await signUpUser(app);

    const response = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Cookie', user.cookie)
      .expect(200);

    const me = MeResponseSchema.parse(response.body);
    expect(me).toMatchObject({ id: user.id, email: user.email, role: 'user' });
    expect(response.body).not.toHaveProperty('banned');
  });

  it('rejects a tampered session cookie', async () => {
    const user = await signUpUser(app);
    const tampered = user.cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));

    await request(app.getHttpServer()).get('/v1/me').set('Cookie', tampered).expect(401);
  });

  it('rejects a session immediately after it is revoked', async () => {
    const user = await signUpUser(app);
    await request(app.getHttpServer()).get('/v1/me').set('Cookie', user.cookie).expect(200);

    await app.get<Auth>(AUTH).api.signOut({ headers: new Headers({ cookie: user.cookie }) });

    await request(app.getHttpServer()).get('/v1/me').set('Cookie', user.cookie).expect(401);
  });

  describe('role enforcement', () => {
    it('forbids a regular user from admin routes', async () => {
      const user = await signUpUser(app);

      await request(app.getHttpServer())
        .get('/v1/guard-probe/admin')
        .set('Cookie', user.cookie)
        .expect(403);
    });

    it('requires administrators to have two-factor authentication enabled', async () => {
      const admin = await signUpUser(app);
      await updateUser(app, admin.id, { role: 'admin' });

      const withoutMfa = await request(app.getHttpServer())
        .get('/v1/guard-probe/admin')
        .set('Cookie', admin.cookie)
        .expect(403);
      expect(withoutMfa.body).toMatchObject({ code: 'MFA_REQUIRED' });

      await updateUser(app, admin.id, { twoFactorEnabled: true });
      await request(app.getHttpServer())
        .get('/v1/guard-probe/admin')
        .set('Cookie', admin.cookie)
        .expect(200, { ok: true });
    });
  });

  describe('CSRF origin check', () => {
    it('rejects cookie-authenticated writes from an untrusted origin', async () => {
      const user = await signUpUser(app);

      const response = await request(app.getHttpServer())
        .post('/v1/guard-probe/mutate')
        .set('Cookie', user.cookie)
        .set('Origin', 'https://evil.example')
        .expect(403);
      expect(response.body).toMatchObject({ code: 'INVALID_ORIGIN' });
    });

    it('rejects cookie-authenticated writes with no origin information', async () => {
      const user = await signUpUser(app);

      await request(app.getHttpServer())
        .post('/v1/guard-probe/mutate')
        .set('Cookie', user.cookie)
        .expect(403);
    });

    it('allows cookie-authenticated writes from a trusted origin', async () => {
      const user = await signUpUser(app);

      await request(app.getHttpServer())
        .post('/v1/guard-probe/mutate')
        .set('Cookie', user.cookie)
        .set('Origin', TRUSTED_ORIGIN)
        .expect(201, { ok: true });
    });
  });
});
