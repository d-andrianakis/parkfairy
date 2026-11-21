import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canKeepPasses,
  forgetAllPasses,
  forgetPass,
  KEEP_UNTIL_HEADER,
  keepPass,
  keptUntil,
  PASS_CACHE,
  PASS_MARK,
  sweepPasses,
} from './offline-pass';

/** A Cache API in memory: keyed by the path or URL, keeping the response as it was put. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: RequestInfo | URL) =>
    new URL(request instanceof Request ? request.url : String(request), 'http://localhost')
      .pathname;
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      put: async (request: RequestInfo | URL, response: Response) => {
        store.set(key(request), response);
      },
      match: async (request: RequestInfo | URL) => store.get(key(request))?.clone(),
      delete: async (request: RequestInfo | URL) => store.delete(key(request)),
      keys: async () => [...store.keys()].map((path) => new Request(`http://localhost${path}`)),
    };
  };
  return {
    stores,
    caches: {
      open,
      has: async (name: string) => stores.has(name),
      delete: async (name: string) => stores.delete(name),
    },
  };
}

const PASS = '/en/bookings/6f1c0a52-8c1e-4f0e-9b7a-2d3e4f5a6b7c/pass';
const UNTIL = new Date(Date.now() + 3 * 86_400_000);

let fake: ReturnType<typeof fakeCaches>;
const register = vi.fn((..._args: unknown[]) => Promise.resolve({}));
const unregister = vi.fn(() => Promise.resolve(true));
const OWNER = 'a0a0a0a0-0000-4000-8000-000000000001';

beforeEach(() => {
  fake = fakeCaches();
  vi.stubGlobal('caches', fake.caches);
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      register,
      ready: Promise.resolve({}),
      getRegistrations: () =>
        Promise.resolve([{ active: { scriptURL: 'https://x.example/pass-sw.js' }, unregister }]),
    },
    configurable: true,
  });
  register.mockClear();
  unregister.mockClear();
  localStorage.clear();
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
    { name: `${location.origin}/_next/static/css/app.css` },
    { name: `${location.origin}/_next/static/chunks/main.js` },
    { name: 'https://js.stripe.com/v3' },
    { name: `${location.origin}/api/v1/bookings/x` },
  ] as unknown as PerformanceEntryList);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

const page = (init: ResponseInit = {}) =>
  new Response(`<html><p ${PASS_MARK}>pass</p></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html' },
    ...init,
  });

describe('offline passes (5A.3)', () => {
  it('can be kept where the browser has workers and a cache, on a secure origin', () => {
    expect(canKeepPasses()).toBe(true);
    Reflect.deleteProperty(navigator, 'serviceWorker');
    expect(canKeepPasses()).toBe(false);
  });

  it('is not offered on an insecure origin', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    expect(canKeepPasses()).toBe(false);
  });

  it('keeps the page with when it stops being served, and our own assets, nothing else', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        fetched.push(String(url));
        return Promise.resolve(String(url) === PASS ? page() : new Response('asset'));
      }),
    );
    await keepPass(PASS, UNTIL, OWNER);
    // For this language's bookings only, not the whole site.
    expect(register).toHaveBeenCalledWith('/pass-sw.js', { scope: '/en/bookings/' });
    const kept = fake.stores.get(PASS_CACHE);
    expect([...(kept?.keys() ?? [])].sort()).toEqual(
      [PASS, '/_next/static/chunks/main.js', '/_next/static/css/app.css'].sort(),
    );
    expect(kept?.get(PASS)?.headers.get(KEEP_UNTIL_HEADER)).toBe(UNTIL.toISOString());
    expect(await kept?.get(PASS)?.text()).toContain('pass</p>');
    // Another origin's script and an API answer are not assets of the page.
    expect(fetched.some((url) => url.includes('stripe') || url.includes('/api/'))).toBe(false);
    expect(fetched[0]).toBe(PASS);
  });

  it('asks the network for the page itself, not a cached one', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(page()));
    vi.stubGlobal('fetch', fetchMock);
    await keepPass(PASS, UNTIL, OWNER);
    expect(fetchMock).toHaveBeenCalledWith(PASS, { credentials: 'same-origin', cache: 'reload' });
  });

  it.each([
    ['a refusal', () => page({ status: 403 })],
    [
      'a redirect, which is the sign-in page standing in',
      () => {
        const response = page();
        Object.defineProperty(response, 'redirected', { value: true });
        return response;
      },
    ],
  ])('keeps nothing when it gets %s', async (_, make) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(make())),
    );
    await expect(keepPass(PASS, UNTIL, OWNER)).rejects.toThrow();
    expect(fake.stores.get(PASS_CACHE)?.size ?? 0).toBe(0);
  });

  it('keeps nothing when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    await expect(keepPass(PASS, UNTIL, OWNER)).rejects.toThrow();
    expect(fake.stores.get(PASS_CACHE)?.size ?? 0).toBe(0);
  });

  it('keeps the page last: an asset that fails leaves it unkept', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url) === PASS
            ? page()
            : String(url).endsWith('main.js')
              ? new Response('no', { status: 500 })
              : new Response('asset'),
        ),
      ),
    );
    await expect(keepPass(PASS, UNTIL, OWNER)).rejects.toThrow();
    expect(await keptUntil(PASS)).toBeNull();
    expect(fake.stores.get(PASS_CACHE)?.has(PASS)).toBe(false);
  });

  it('does not fetch again an asset it has', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(String(url) === PASS ? page() : new Response('asset')),
    );
    vi.stubGlobal('fetch', fetchMock);
    await keepPass(PASS, UNTIL, OWNER);
    fetchMock.mockClear();
    await keepPass(PASS, UNTIL, OWNER);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([PASS]);
  });

  it('keeps no page that is not the pass, though the server said 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<p>unavailable</p>'))),
    );
    await expect(keepPass(PASS, UNTIL, OWNER)).rejects.toThrow('not a pass');
    expect(await keptUntil(PASS)).toBeNull();
  });

  it('stores the copy without the headers that say how the body travelled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          page({ headers: { 'content-encoding': 'gzip', 'content-length': '5', 'x-a': 'b' } }),
        ),
      ),
    );
    await keepPass(PASS, UNTIL, OWNER);
    const kept = fake.stores.get(PASS_CACHE)?.get(PASS);
    expect(kept?.headers.get('content-encoding')).toBeNull();
    expect(kept?.headers.get('content-length')).toBeNull();
    expect(kept?.headers.get('x-a')).toBe('b');
  });

  it('says until when a pass is kept, and none once it has passed or was never kept', async () => {
    expect(await keptUntil(PASS)).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(page())),
    );
    await keepPass(PASS, UNTIL, OWNER);
    expect((await keptUntil(PASS))?.toISOString()).toBe(UNTIL.toISOString());
    await keepPass(PASS, new Date(Date.now() - 1000), OWNER);
    expect(await keptUntil(PASS)).toBeNull();
  });

  it('forgets one pass, or every one, and survives storage that is blocked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(page())),
    );
    await keepPass(PASS, UNTIL, OWNER);
    await forgetPass(PASS);
    expect(await keptUntil(PASS)).toBeNull();
    await keepPass(PASS, UNTIL, OWNER);
    await forgetAllPasses();
    expect(fake.stores.has(PASS_CACHE)).toBe(false);
    // And the worker that served them, and who they were for.
    expect(unregister).toHaveBeenCalled();
    expect(localStorage.getItem('parkfairy.pass-owner')).toBeNull();
    vi.stubGlobal('caches', {
      delete: () => Promise.reject(new Error('blocked')),
      open: () => Promise.reject(new Error('blocked')),
    });
    await expect(forgetAllPasses()).resolves.toBeUndefined();
    expect(await keptUntil(PASS)).toBeNull();
  });
});

describe('sweepPasses (5A.3)', () => {
  const kept = async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(page())),
    );
    await keepPass(PASS, UNTIL, OWNER);
  };

  it('does nothing where nothing was ever kept, and makes no cache', async () => {
    await sweepPasses({ signedIn: false, userId: null });
    expect(fake.stores.has(PASS_CACHE)).toBe(false);
    expect(unregister).not.toHaveBeenCalled();
  });

  it('keeps what is the signed-in account’s, in its time', async () => {
    await kept();
    await sweepPasses({ signedIn: true, userId: OWNER });
    expect(await keptUntil(PASS)).not.toBeNull();
    expect(unregister).not.toHaveBeenCalled();
  });

  it('takes everything off when nobody is signed in: a session that lapsed or was ended elsewhere', async () => {
    await kept();
    await sweepPasses({ signedIn: false, userId: null });
    expect(fake.stores.has(PASS_CACHE)).toBe(false);
    expect(unregister).toHaveBeenCalled();
  });

  it('takes everything off when another account is signed in', async () => {
    await kept();
    await sweepPasses({ signedIn: true, userId: 'a0a0a0a0-0000-4000-8000-0000000000ff' });
    expect(fake.stores.has(PASS_CACHE)).toBe(false);
    expect(localStorage.getItem('parkfairy.pass-owner')).toBeNull();
  });

  it('takes off what has passed its time, and with the last of it the assets and the worker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(page())),
    );
    await keepPass(PASS, new Date(Date.now() + 5), OWNER);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await sweepPasses({ signedIn: true, userId: OWNER });
    expect(fake.stores.has(PASS_CACHE)).toBe(false);
    expect(unregister).toHaveBeenCalled();
  });

  it('forgetting the last pass takes the assets and the worker with it, an earlier one does not', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(page())),
    );
    const other = '/en/bookings/11111111-1111-4111-8111-111111111111/pass';
    await keepPass(PASS, UNTIL, OWNER);
    await keepPass(other, UNTIL, OWNER);
    await forgetPass(PASS);
    expect(fake.stores.has(PASS_CACHE)).toBe(true);
    expect(unregister).not.toHaveBeenCalled();
    await forgetPass(other);
    expect(fake.stores.has(PASS_CACHE)).toBe(false);
    expect(unregister).toHaveBeenCalled();
  });
});
