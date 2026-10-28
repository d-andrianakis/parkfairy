import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import { OriginGuard } from './origin.guard.js';

const guard = new OriginGuard({ trustedOrigins: ['https://app.example.gr'] } as Env);

function contextFor(method: string, headers: Record<string, string>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, headers }) }),
  } as unknown as ExecutionContext;
}

const cookie = 'parkfairy.session_token=abc';

describe('OriginGuard', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('allows safe %s requests from anywhere', (method) => {
    expect(guard.canActivate(contextFor(method, { cookie, origin: 'https://evil.example' }))).toBe(
      true,
    );
  });

  it('allows unsafe requests that carry no cookies (webhooks, server-to-server)', () => {
    expect(guard.canActivate(contextFor('POST', { origin: 'https://evil.example' }))).toBe(true);
  });

  it('allows cookie-authenticated writes from a trusted origin', () => {
    expect(
      guard.canActivate(contextFor('POST', { cookie, origin: 'https://app.example.gr' })),
    ).toBe(true);
  });

  it('falls back to the Referer origin when Origin is absent', () => {
    expect(
      guard.canActivate(
        contextFor('DELETE', { cookie, referer: 'https://app.example.gr/el/account' }),
      ),
    ).toBe(true);
  });

  it.each([
    ['an untrusted origin', { cookie, origin: 'https://evil.example' }],
    ['a look-alike origin', { cookie, origin: 'https://app.example.gr.evil.example' }],
    ['no origin information', { cookie }],
    ['a malformed referer', { cookie, referer: 'not a url' }],
  ])('rejects cookie-authenticated writes with %s', (_label, headers) => {
    expect(() => guard.canActivate(contextFor('PATCH', headers))).toThrow(ForbiddenException);
  });
});
