/** Where a signed-in person may be sent: a path on this site, in no language yet. */
const LOCALE_PREFIX = /^\/(?:el|en)(?=\/|$)/;

/**
 * Accepts only same-site relative paths, so `?next=` cannot become an open redirect: no scheme-less
 * host (`//`, a backslash or a control character anywhere, which browsers read as a slash), no API
 * path, and no language prefix, since the router adds one and would double it.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/listings'): string {
  if (!value || !value.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (value.startsWith('//') || value === '/api' || value.startsWith('/api/')) return fallback;
  const path = value.replace(LOCALE_PREFIX, '') || '/';
  return path.startsWith('//') ? fallback : path;
}
