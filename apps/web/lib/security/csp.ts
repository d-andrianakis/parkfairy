import { SUPPORTED_LOCALES } from '@parkfairy/contracts/locales';

export interface CspOptions {
  nonce: string;
  /** Next.js dev tooling (React refresh, Turbopack) needs eval. Never true in production. */
  isDev: boolean;
  /** Only meaningful over HTTPS; on plain-http localhost it would break subresource loads. */
  upgradeInsecureRequests: boolean;
  /** Pages with a Mapbox map (`allowsMaps`). Nothing else gets these origins. */
  maps?: boolean;
}

/**
 * The pages that may load a Mapbox map. The whole owner area, not just the location step: moving
 * between its pages doesn't load a new document, so the policy in force is that of the page the
 * owner arrived on; from outside it, links to the location step load a real page (`StepLink`).
 * And the search page, for its results map (decision #41), which links into it also load as real
 * pages (`SearchLink`). Address suggestions need nothing here: they come through our API (#40).
 */
const MAP_PAGES = new RegExp(`^/(?:${SUPPORTED_LOCALES.join('|')})/(?:owner(?:/|$)|search/?$)`);

export function allowsMaps(pathname: string): boolean {
  return MAP_PAGES.test(pathname);
}

/** Tiles, styles, fonts and search come from the first; the second is its usage telemetry. */
const MAPBOX_ORIGINS = ['https://api.mapbox.com', 'https://events.mapbox.com'];

/**
 * Strict, nonce-based Content-Security-Policy. Next.js reads the nonce from the request's
 * CSP header and applies it to its own scripts; `strict-dynamic` lets those scripts load
 * their chunks. Any third-party origin (maps, payments) must be added here deliberately.
 */
export function buildContentSecurityPolicy({
  nonce,
  isDev,
  upgradeInsecureRequests,
  maps = false,
}: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // React `style` attributes cannot carry nonces, so inline styles stay allowed; this is
    // the accepted residual risk (style injection), scripts remain locked down.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'blob:', 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(maps ? MAPBOX_ORIGINS : [])],
    // Falling back to script-src would refuse the map's worker: strict-dynamic ignores 'self'.
    ...(maps ? { 'worker-src': ["'self'"] } : {}),
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };

  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (upgradeInsecureRequests) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

/** 128-bit random nonce, base64-encoded, fresh for every response. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
