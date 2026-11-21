/**
 * Keeping a booking pass on the device (5A.3): an opt-in copy of one page, and of the scripts, styles
 * and fonts it was drawn with, in a cache of its own that `public/pass-sw.js` serves from when the
 * network is gone. Nothing is kept unless the driver presses the button, the copy lasts until a day
 * after the stay, and every copy goes when its account does: on signing out, and whenever a page is
 * next loaded online by someone else or by no one (`sweepPasses`, from the root layout), since a
 * device with no network can't ask who is signed in. Browsers that can't keep pages say so.
 */
export const PASS_CACHE = 'pass-v1';
/** The header that carries when a kept page stops being served; the worker reads it too. */
export const KEEP_UNTIL_HEADER = 'x-keep-until';
/** What only the real pass page contains: an error page with a 200 must never replace a good copy. */
export const PASS_MARK = 'data-pass="reference"';
/** Whose copies these are (an account id, nothing else), to tell another account's visit. */
const OWNER_KEY = 'parkfairy.pass-owner';
const WORKER = '/pass-sw.js';

/** Whether this browser can keep a page: a service worker and the Cache API, on a secure origin. */
export function canKeepPasses(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof caches !== 'undefined' &&
    window.isSecureContext
  );
}

/**
 * The same response with one more header. The headers that describe how the body travelled go: the
 * body is read already, and a stored copy claiming to be compressed would be decoded again.
 */
function withHeader(response: Response, body: BodyInit | null, name: string, value: string) {
  const headers = new Headers(response.headers);
  for (const travelled of ['content-encoding', 'content-length', 'transfer-encoding']) {
    headers.delete(travelled);
  }
  headers.set(name, value);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/** Scripts, styles and fonts this page loaded from us: what the kept page needs to look as it did. */
function assetsOfThisPage(): string[] {
  return performance
    .getEntriesByType('resource')
    .map((entry) => new URL(entry.name, location.href))
    .filter((url) => url.origin === location.origin && url.pathname.startsWith('/_next/static/'))
    .map((url) => url.pathname + url.search);
}

const keptTime = (response: Response | undefined) =>
  Date.parse(response?.headers.get(KEEP_UNTIL_HEADER) ?? '');

/** When a kept copy of `path` stops being served, or null where none is kept. */
export async function keptUntil(path: string): Promise<Date | null> {
  if (!canKeepPasses()) return null;
  try {
    const until = keptTime(await (await caches.open(PASS_CACHE)).match(path));
    return Number.isNaN(until) || until <= Date.now() ? null : new Date(until);
  } catch {
    return null;
  }
}

/**
 * Keeps the page at `path` until `until`, for the account `owner`: registers the worker for the
 * bookings of this language only, then saves the page as the server gives it now, and its assets.
 * Throws where it could not (offline, signed out, a redirect, an error page), and keeps nothing.
 */
export async function keepPass(path: string, until: Date, owner: string): Promise<void> {
  const language = path.split('/')[1] ?? '';
  await navigator.serviceWorker.register(WORKER, { scope: `/${language}/bookings/` });
  await navigator.serviceWorker.ready;
  const cache = await caches.open(PASS_CACHE);
  const response = await fetch(path, { credentials: 'same-origin', cache: 'reload' });
  // A redirect is the sign-in page standing in for a page this account may not see.
  if (!response.ok || response.redirected) throw new Error('The page could not be kept');
  const body = await response.text();
  if (!body.includes(PASS_MARK)) throw new Error('That is not a pass');
  // The assets first and the page last: a pass kept without its styles would open as a bare page, so
  // a failure on the way leaves the page unkept, and the assets for the next try.
  await Promise.all(
    assetsOfThisPage().map(async (asset) => {
      if (await cache.match(asset)) return;
      const fetched = await fetch(asset, { credentials: 'same-origin' });
      if (!fetched.ok) throw new Error('A style or script could not be kept');
      await cache.put(asset, fetched);
    }),
  );
  try {
    localStorage.setItem(OWNER_KEY, owner);
  } catch {
    // Without it another account's visit can't be told apart; signing out still clears.
  }
  await cache.put(path, withHeader(response, body, KEEP_UNTIL_HEADER, until.toISOString()));
}

/** Every page kept (the assets have no end of their own). */
async function keptPages(cache: Cache): Promise<Request[]> {
  const pages: Request[] = [];
  for (const request of await cache.keys()) {
    if (!Number.isNaN(keptTime(await cache.match(request)))) pages.push(request);
  }
  return pages;
}

/** Forgets the copy of one page, and everything when it was the last. */
export async function forgetPass(path: string): Promise<void> {
  if (!canKeepPasses()) return;
  const cache = await caches.open(PASS_CACHE);
  await cache.delete(path);
  if ((await keptPages(cache)).length === 0) await forgetAllPasses();
}

/**
 * Forgets every kept pass, its assets and the workers that served them: when someone signs out,
 * whose passes they were. Best effort: storage can be blocked, and there is then nothing to forget.
 */
export async function forgetAllPasses(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(PASS_CACHE);
  } catch {
    // Blocked: nothing kept.
  }
  try {
    localStorage.removeItem(OWNER_KEY);
  } catch {
    // Blocked: nothing kept.
  }
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => registration.active?.scriptURL.endsWith(WORKER))
          .map((registration) => registration.unregister()),
      );
    }
  } catch {
    // Blocked: nothing registered.
  }
}

/**
 * Run on a page load, online: takes off the device what should no longer be there. No one is
 * signed in, or a different account is: every copy goes. Otherwise what has passed its time goes,
 * and with the last of it the assets and the worker. Cheap where nothing was ever kept.
 */
export async function sweepPasses({
  signedIn,
  userId,
}: {
  signedIn: boolean;
  userId: string | null;
}): Promise<void> {
  try {
    if (typeof caches === 'undefined' || !(await caches.has(PASS_CACHE))) return;
    let owner: string | null = null;
    try {
      owner = localStorage.getItem(OWNER_KEY);
    } catch {
      owner = null;
    }
    if (!signedIn || (owner !== null && owner !== userId)) {
      await forgetAllPasses();
      return;
    }
    const cache = await caches.open(PASS_CACHE);
    let live = 0;
    for (const request of await keptPages(cache)) {
      const until = keptTime(await cache.match(request));
      if (until <= Date.now()) await cache.delete(request);
      else live++;
    }
    if (live === 0) await forgetAllPasses();
  } catch {
    // Storage blocked or gone mid-way: nothing more to do.
  }
}
