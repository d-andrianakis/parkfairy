// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
}));
vi.mock('better-auth/next-js', () => ({ toNextJsHandler: () => handlers }));
vi.mock('@/lib/auth', () => ({ getAuth: vi.fn() }));

const route = await import('./route');
const call = (method: string, path: string, body?: unknown) =>
  new Request(`http://localhost:3001${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(() => {
  for (const handler of Object.values(handlers)) handler.mockReset();
  // A new answer each time: a body can be read once.
  for (const handler of Object.values(handlers)) {
    handler.mockImplementation(() => Promise.resolve(new Response('served')));
  }
});

describe('the staff origin’s auth route', () => {
  it('answers an empty 404, and serves nothing, for every method on a path not allowed', async () => {
    for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const) {
      for (const path of [
        '/api/auth/sign-up/email',
        '/api/auth/get-session',
        '/api/auth/two-factor/enable',
        '/api/auth/delete-user',
      ]) {
        const response = await route[method](call(method, path, method === 'GET' ? undefined : {}));
        expect(response.status, `${method} ${path}`).toBe(404);
        expect(await response.text()).toBe('');
      }
      expect(handlers[method]).not.toHaveBeenCalled();
    }
  });

  it('serves the four endpoints staff need, as the right method only', async () => {
    for (const path of [
      '/api/auth/sign-in/email',
      '/api/auth/two-factor/verify-totp',
      '/api/auth/two-factor/verify-backup-code',
      '/api/auth/sign-out',
    ]) {
      const response = await route.POST(call('POST', path, { code: '123456' }));
      expect(await response.text(), path).toBe('served');
    }
    expect(handlers.POST).toHaveBeenCalledTimes(4);
    // The same paths by another method are not served.
    expect((await route.GET(call('GET', '/api/auth/sign-in/email'))).status).toBe(404);
    expect((await route.PUT(call('PUT', '/api/auth/sign-out', {}))).status).toBe(404);
    expect((await route.DELETE(call('DELETE', '/api/auth/sign-out', {}))).status).toBe(404);
    expect((await route.PATCH(call('PATCH', '/api/auth/sign-out', {}))).status).toBe(404);
    expect(handlers.GET).not.toHaveBeenCalled();
  });

  it('refuses a second step that asks to remember the browser, which would skip the next one', async () => {
    for (const path of [
      '/api/auth/two-factor/verify-totp',
      '/api/auth/two-factor/verify-backup-code',
    ]) {
      const response = await route.POST(call('POST', path, { code: '123456', trustDevice: true }));
      expect(response.status, path).toBe(400);
    }
    expect(handlers.POST).not.toHaveBeenCalled();
  });

  it('lets the second step through when it does not, or says it does not', async () => {
    for (const body of [{ code: '123456' }, { code: '123456', trustDevice: false }]) {
      const response = await route.POST(call('POST', '/api/auth/two-factor/verify-totp', body));
      expect(await response.text()).toBe('served');
    }
    // A body that is no JSON is Better Auth's to refuse, with its own answer.
    const broken = new Request('http://localhost:3001/api/auth/two-factor/verify-totp', {
      method: 'POST',
      body: 'not json',
    });
    expect(await (await route.POST(broken)).text()).toBe('served');
    expect(handlers.POST).toHaveBeenCalledTimes(3);
  });

  it('hands Better Auth the request unread, so sign-in can read its own body', async () => {
    const request = call('POST', '/api/auth/two-factor/verify-totp', { code: '123456' });
    await route.POST(request);
    const [passed] = handlers.POST.mock.calls[0] as [Request];
    expect(await passed.json()).toEqual({ code: '123456' });
  });
});
