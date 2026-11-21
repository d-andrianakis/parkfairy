import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The worker that serves a kept booking pass (5A.3), run as a browser would with its globals stood in.
const SOURCE = readFileSync(resolve(process.cwd(), 'public/pass-sw.js'), 'utf8');
const ORIGIN = 'https://parkfairy.example';
const PASS = '/en/bookings/6f1c0a52-8c1e-4f0e-9b7a-2d3e4f5a6b7c/pass';
const MARK = 'data-pass="reference"';

type Listener = (event: unknown) => void;

function worker(options: { fetch: (request: unknown) => Promise<Response>; hasCache?: boolean }) {
  const listeners = new Map<string, Listener>();
  const store = new Map<string, Response>();
  const pathOf = (request: unknown) =>
    typeof request === 'string' ? request : new URL((request as { url: string }).url).pathname;
  const cache = {
    match: async (request: unknown) => store.get(pathOf(request))?.clone(),
    put: async (request: unknown, response: Response) => void store.set(pathOf(request), response),
    delete: async (request: unknown) => store.delete(pathOf(request)),
    keys: async () => [...store.keys()],
  };
  const opened = vi.fn(async () => cache);
  const deletedCaches = vi.fn(async () => {
    store.clear();
    return true;
  });
  const unregister = vi.fn(() => Promise.resolve(true));
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(() => Promise.resolve()) },
    registration: { unregister },
  };
  runInNewContext(SOURCE, {
    self,
    caches: {
      open: opened,
      has: async () => options.hasCache ?? true,
      delete: deletedCaches,
      match: async (request: unknown) => cache.match(request),
    },
    fetch: options.fetch,
    URL,
    Headers,
    Response,
    Date,
    Number,
  });
  const pending: Promise<unknown>[] = [];
  /** Sends a request through the worker: its answer, or null where it left the request alone. */
  async function request(url: string, init: { method?: string; mode?: string } = {}) {
    const sent: { answer: Promise<Response> | null } = { answer: null };
    listeners.get('fetch')?.({
      request: { url: `${url.startsWith('http') ? '' : ORIGIN}${url}`, method: 'GET', ...init },
      respondWith: (promise: Promise<Response>) => (sent.answer = promise),
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    return sent.answer;
  }
  /** What the worker went on doing after it had answered. */
  const settle = async () => void (await Promise.all(pending.splice(0)));
  return { request, settle, store, listeners, self, opened, deletedCaches, unregister };
}

const keep = (store: Map<string, Response>, path: string, until: Date, body = 'kept') =>
  store.set(path, new Response(body, { headers: { 'x-keep-until': until.toISOString() } }));
const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 1000);
const offline = () => Promise.reject(new TypeError('offline'));
const page = (body = `<p ${MARK}>fresh</p>`, init: ResponseInit = { status: 200 }) =>
  Promise.resolve(new Response(body, init));

beforeEach(() => vi.clearAllMocks());

describe('the pass worker', () => {
  it('takes over at once, and purges what has passed its time when it starts', async () => {
    const { store, listeners, self } = worker({ fetch: offline });
    keep(store, PASS, PAST);
    keep(store, '/en/bookings/other/pass', FUTURE);
    store.set('/_next/static/b.css', new Response('an asset, no time set'));
    listeners.get('install')?.({});
    expect(self.skipWaiting).toHaveBeenCalled();
    let done: Promise<unknown> = Promise.resolve();
    listeners.get('activate')?.({ waitUntil: (promise: Promise<unknown>) => (done = promise) });
    await done;
    expect([...store.keys()].sort()).toEqual(['/_next/static/b.css', '/en/bookings/other/pass']);
  });

  it('at start-up never takes the cache or itself away: a pass may be half kept, its assets in and the page not yet', async () => {
    const { store, listeners, deletedCaches, unregister } = worker({ fetch: offline });
    store.set('/_next/static/b.css', new Response('asset'));
    let done: Promise<unknown> = Promise.resolve();
    listeners.get('activate')?.({ waitUntil: (promise: Promise<unknown>) => (done = promise) });
    await done;
    expect(deletedCaches).not.toHaveBeenCalled();
    expect(unregister).not.toHaveBeenCalled();
    expect(store.has('/_next/static/b.css')).toBe(true);
  });

  it('with the last pass found expired, takes the assets and itself away', async () => {
    const { request, settle, store, deletedCaches, unregister } = worker({ fetch: offline });
    keep(store, PASS, PAST);
    store.set('/_next/static/b.css', new Response('asset'));
    await request(PASS, { mode: 'navigate' });
    await settle();
    expect(deletedCaches).toHaveBeenCalledWith('pass-v1');
    expect(unregister).toHaveBeenCalled();
  });

  it('makes no cache where there is none, on a device that was signed out', async () => {
    const { listeners, opened, unregister } = worker({ fetch: offline, hasCache: false });
    let done: Promise<unknown> = Promise.resolve();
    listeners.get('activate')?.({ waitUntil: (promise: Promise<unknown>) => (done = promise) });
    await done;
    expect(opened).not.toHaveBeenCalled();
    expect(unregister).not.toHaveBeenCalled();
  });

  it('leaves alone everything that is not a pass or a script or style: other pages, APIs, other origins, writes', async () => {
    const { request } = worker({ fetch: offline });
    expect(await request('/en/bookings', { mode: 'navigate' })).toBeNull();
    expect(
      await request('/en/bookings/6f1c0a52-8c1e-4f0e-9b7a-2d3e4f5a6b7c', { mode: 'navigate' }),
    ).toBeNull();
    expect(await request(`${PASS}/extra`, { mode: 'navigate' })).toBeNull();
    expect(await request('/api/v1/bookings/x')).toBeNull();
    expect(await request('https://other.example/_next/static/a.js')).toBeNull();
    expect(await request(PASS, { method: 'POST', mode: 'navigate' })).toBeNull();
    // A pass fetched as a subresource rather than opened as a page isn't served from the copy.
    expect(await request(PASS, { mode: 'cors' })).toBeNull();
  });

  it('shows the network’s page when online, and renews the copy behind it with the same end', async () => {
    const { request, settle, store } = worker({ fetch: () => page() });
    keep(store, PASS, FUTURE, 'old');
    const response = await request(PASS, { mode: 'navigate' });
    expect(await (await response)?.text()).toBe(`<p ${MARK}>fresh</p>`);
    await settle();
    const renewed = store.get(PASS);
    expect(await renewed?.text()).toBe(`<p ${MARK}>fresh</p>`);
    expect(renewed?.headers.get('x-keep-until')).toBe(FUTURE.toISOString());
  });

  it('does not hold the page back for the cache: it answers first, and caches after', async () => {
    const { request, store } = worker({ fetch: () => page() });
    keep(store, PASS, FUTURE, 'old');
    await request(PASS, { mode: 'navigate' });
    // Answered, with the old copy still there until `waitUntil`'s work has run.
    expect(await store.get(PASS)?.text()).toBe('old');
  });

  it('stores a renewed copy without the headers that say how the body travelled', async () => {
    const compressed = () =>
      page(`<p ${MARK}>fresh</p>`, {
        status: 200,
        headers: { 'content-encoding': 'gzip', 'content-length': '999', 'x-other': 'kept' },
      });
    const { request, settle, store } = worker({ fetch: compressed });
    keep(store, PASS, FUTURE, 'old');
    await request(PASS, { mode: 'navigate' });
    await settle();
    const renewed = store.get(PASS);
    expect(renewed?.headers.get('content-encoding')).toBeNull();
    expect(renewed?.headers.get('content-length')).toBeNull();
    expect(renewed?.headers.get('x-other')).toBe('kept');
  });

  it.each([
    ['a refusal', () => page('no', { status: 403 })],
    ['an error page that is not the pass, though it says 200', () => page('<p>unavailable</p>')],
    [
      'a redirect, which is the sign-in page standing in',
      () => {
        const response = new Response(`<p ${MARK}>sign in</p>`, { status: 200 });
        Object.defineProperty(response, 'redirected', { value: true });
        return Promise.resolve(response);
      },
    ],
  ])('keeps the old copy when the network answers with %s', async (_, answer) => {
    const { request, settle, store } = worker({ fetch: answer });
    keep(store, PASS, FUTURE, 'old');
    await request(PASS, { mode: 'navigate' });
    await settle();
    expect(await store.get(PASS)?.text()).toBe('old');
  });

  it('does not keep a page that was not kept, even when it is online', async () => {
    const { request, settle, store } = worker({ fetch: () => page() });
    await request(PASS, { mode: 'navigate' });
    await settle();
    expect(store.size).toBe(0);
  });

  it('serves the kept copy when the network is gone, whatever the query string says', async () => {
    const { request, store } = worker({ fetch: offline });
    keep(store, PASS, FUTURE);
    const response = await request(`${PASS}?x=1`, { mode: 'navigate' });
    expect(await (await response)?.text()).toBe('kept');
  });

  it('serves nothing once the time has passed, and forgets the copy', async () => {
    const { request, settle, store } = worker({ fetch: offline });
    keep(store, PASS, PAST);
    const response = await request(PASS, { mode: 'navigate' });
    expect((await response)?.type).toBe('error');
    await settle();
    expect(store.has(PASS)).toBe(false);
  });

  it('forgets an expired copy when it meets one online too, rather than keep it for good', async () => {
    const { request, settle, store } = worker({ fetch: () => page() });
    keep(store, PASS, PAST);
    await request(PASS, { mode: 'navigate' });
    await settle();
    expect(store.has(PASS)).toBe(false);
  });

  it('serves no pass that was never kept: the browser’s own offline page', async () => {
    const { request } = worker({ fetch: offline });
    const response = await request(PASS, { mode: 'navigate' });
    expect((await response)?.type).toBe('error');
  });

  it('serves a kept script or style from the copy, and any other from the network', async () => {
    const { request, store } = worker({ fetch: () => Promise.resolve(new Response('network')) });
    keep(store, '/_next/static/css/app.css', FUTURE, 'from the copy');
    expect(await (await request('/_next/static/css/app.css'))?.text()).toBe('from the copy');
    expect(await (await request('/_next/static/css/other.css'))?.text()).toBe('network');
  });
});
