import {
  Controller,
  ForbiddenException,
  Get,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Auth } from '@parkfairy/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Public, Roles, type AuthenticatedRequest } from './auth.decorators.js';
import { AuthGuard } from './auth.guard.js';

@Controller()
class ProbeController {
  @Get() @Public() open() {}
  @Get() member() {}
  @Get() @Roles('admin') admin() {}
}

function contextFor(handler: keyof ProbeController, request: Partial<AuthenticatedRequest>) {
  return {
    // The guard only reads decorator metadata from the handler; it never calls it.
    getHandler: () => Reflect.get(ProbeController.prototype, handler),
    getClass: () => ProbeController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function sessionFor(user: { role: 'user' | 'admin'; twoFactorEnabled?: boolean }) {
  return { user: { id: 'user-1', ...user }, session: { id: 'session-1' } };
}

describe('AuthGuard', () => {
  const getSession = vi.fn();
  const guard = new AuthGuard(new Reflector(), { api: { getSession } } as unknown as Auth);

  beforeEach(() => getSession.mockReset());

  it('lets @Public routes through without looking up a session', async () => {
    await expect(guard.canActivate(contextFor('open', { headers: {} }))).resolves.toBe(true);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('rejects requests without a valid session', async () => {
    getSession.mockResolvedValue(null);
    await expect(guard.canActivate(contextFor('member', { headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('verifies the cookie without refreshing it and attaches the user', async () => {
    getSession.mockResolvedValue(sessionFor({ role: 'user' }));
    const request: Partial<AuthenticatedRequest> = {
      headers: { cookie: 'parkfairy.session_token=abc' },
    };

    await expect(guard.canActivate(contextFor('member', request))).resolves.toBe(true);

    const [{ headers, query }] = getSession.mock.calls[0] as [{ headers: Headers; query: unknown }];
    expect(headers.get('cookie')).toBe('parkfairy.session_token=abc');
    expect(query).toEqual({ disableRefresh: true });
    expect(request.user?.id).toBe('user-1');
    expect(request.authSession?.id).toBe('session-1');
  });

  it('forbids non-admins from admin routes', async () => {
    getSession.mockResolvedValue(sessionFor({ role: 'user' }));
    await expect(guard.canActivate(contextFor('admin', { headers: {} }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('requires administrators to have two-factor authentication', async () => {
    getSession.mockResolvedValue(sessionFor({ role: 'admin', twoFactorEnabled: false }));
    const error = await guard
      .canActivate(contextFor('admin', { headers: {} }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'MFA_REQUIRED' });
  });

  it('admits administrators with two-factor enabled', async () => {
    getSession.mockResolvedValue(sessionFor({ role: 'admin', twoFactorEnabled: true }));
    await expect(guard.canActivate(contextFor('admin', { headers: {} }))).resolves.toBe(true);
  });
});
