/*
 * Serves a kept booking pass when the network is gone (5A.3). It is registered for one language's
 * bookings only (`/en/bookings/`), and does nothing for any page the driver has not chosen to keep: a
 * request that is not for a pass, or not for a script or style a kept pass needs, goes to the network
 * as if this file were not here. The copy is made by the page itself (lib/offline-pass.ts), in the cache
 * named below, with the time it stops being served in a header. Online, the network wins and the kept
 * copy is renewed behind the response, so the way in appears when it is shown; a page that is not the
 * pass itself (an error page) never replaces it. What has run out goes, and with the last of it the
 * assets and this worker.
 */
const CACHE = 'pass-v1';
const KEEP_UNTIL = 'x-keep-until';
/** What only the pass page contains (`PASS_MARK` in lib/offline-pass.ts). */
const MARK = 'data-pass="reference"';
const PASS = /^\/(?:el|en)\/bookings\/[0-9a-f-]{36}\/pass\/?$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim().then(purgeExpired));
});

function expired(response) {
  const until = Date.parse(response.headers.get(KEEP_UNTIL) || '');
  return !Number.isNaN(until) && until <= Date.now();
}

/**
 * Takes away what has passed its time. With `whenLast`, and no page left, the assets go too, and the
 * worker: only asked where a page has just been found expired, never at start-up, when a driver
 * keeping a pass may have put the assets in and not yet the page. Looked for, not opened: opening
 * makes the cache, and a signed-out device has none to keep.
 */
async function purgeExpired(whenLast) {
  if (!(await caches.has(CACHE))) return;
  const cache = await caches.open(CACHE);
  let live = 0;
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (!response || !response.headers.has(KEEP_UNTIL)) continue;
    if (expired(response)) await cache.delete(request);
    else live++;
  }
  if (whenLast && live === 0) {
    await caches.delete(CACHE);
    await self.registration.unregister();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && PASS.test(url.pathname)) {
    event.respondWith(pass(event, request, url));
  } else if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(asset(request));
  }
});

/** The network first, so a driver online sees the page as it is; the kept copy only without it. */
async function pass(event, request, url) {
  const kept = await caches.match(url.pathname, { cacheName: CACHE });
  try {
    const response = await fetch(request);
    if (kept) {
      // After the page has gone to the browser: caching it must not hold its first byte back.
      const renewable = response.ok && !response.redirected;
      event.waitUntil(
        expired(kept)
          ? purgeExpired(true)
          : renewable
            ? renew(url.pathname, kept, response.clone())
            : Promise.resolve(),
      );
    }
    return response;
  } catch {
    if (kept && !expired(kept)) return kept;
    if (kept) event.waitUntil(purgeExpired(true));
    return Response.error();
  }
}

/** The kept copy as the server says it is now, with the same end: only if it is the pass itself. */
async function renew(path, kept, response) {
  const body = await response.text();
  if (!body.includes(MARK)) return;
  const headers = new Headers(response.headers);
  // How the body travelled is not how it is stored: a copy claiming to be compressed is decoded twice.
  for (const travelled of ['content-encoding', 'content-length', 'transfer-encoding']) {
    headers.delete(travelled);
  }
  headers.set(KEEP_UNTIL, kept.headers.get(KEEP_UNTIL));
  const cache = await caches.open(CACHE);
  await cache.put(
    path,
    new Response(body, { status: response.status, statusText: response.statusText, headers }),
  );
}

/** A kept pass's scripts and styles come from the kept copy; any other from the network. */
async function asset(request) {
  const hit = await caches.match(request, { cacheName: CACHE });
  return hit || fetch(request);
}
