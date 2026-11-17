// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redirect } from '@/i18n/navigation';

import { getAuth } from './auth';
import { getLayoutSession, getSession, requireSession, standingOf } from './session';

vi.mock('./auth', () => ({ getAuth: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ cookie: 'parkfairy.session_token=abc' })),
}));
vi.mock('next-intl/server', () => ({ getLocale: () => Promise.resolve('el') }));

const getSessionApi = vi.fn();
beforeEach(() => {
  getSessionApi.mockReset();
  vi.mocked(getAuth).mockReturnValue({ api: { getSession: getSessionApi } } as never);
  vi.mocked(redirect).mockReset();
});

describe('what an account may see on the staff screens', () => {
  it('opens them to staff with a second factor, and only them', () => {
    expect(standingOf({ role: 'admin', twoFactorEnabled: true })).toBe('staff');
  });

  it('sends staff with no second factor to turn it on', () => {
    expect(standingOf({ role: 'admin', twoFactorEnabled: false })).toBe('no-second-factor');
    expect(standingOf({ role: 'admin', twoFactorEnabled: null })).toBe('no-second-factor');
    expect(standingOf({ role: 'admin' })).toBe('no-second-factor');
  });

  it('shows everyone else that the screens are not theirs, second factor or not', () => {
    expect(standingOf({ role: 'user', twoFactorEnabled: true })).toBe('not-staff');
    expect(standingOf({ role: 'user', twoFactorEnabled: false })).toBe('not-staff');
    expect(standingOf({ role: null, twoFactorEnabled: true })).toBe('not-staff');
    expect(standingOf({})).toBe('not-staff');
  });
});

describe('the session of a request', () => {
  it('is looked up with the request’s cookie and never renewed: a staff session ends a week after sign-in', async () => {
    getSessionApi.mockResolvedValue({ user: { id: 'u' } });
    await getSession();
    const [options] = getSessionApi.mock.calls[0] as [{ headers: Headers; query: object }];
    expect(options.query).toEqual({ disableRefresh: true });
    expect(options.headers.get('cookie')).toBe('parkfairy.session_token=abc');
  });

  it('renders signed out when the lookup fails, and logs a name and a code, never the message', async () => {
    const error = Object.assign(new Error('select … where token = $1 (secret-token)'), {
      name: 'DatabaseError',
      code: '57014',
    });
    getSessionApi.mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await getLayoutSession()).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token');
    expect(log.mock.calls[0]?.[1]).toEqual({ name: 'DatabaseError', code: '57014' });
    log.mockRestore();
  });
});

describe('asking for a session', () => {
  it('sends a stranger to sign in, in their language, and back to where they were headed', async () => {
    getSessionApi.mockResolvedValue(null);
    await requireSession('/audit');
    expect(redirect).toHaveBeenCalledWith({
      href: { pathname: '/sign-in', query: { next: '/audit' } },
      locale: 'el',
    });
  });

  it('gives a signed-in account its standing, and sends it nowhere', async () => {
    getSessionApi.mockResolvedValue({ user: { role: 'admin', twoFactorEnabled: true } });
    const result = await requireSession('/audit');
    expect(result).toMatchObject({ standing: 'staff' });
    expect(redirect).not.toHaveBeenCalled();
  });
});
