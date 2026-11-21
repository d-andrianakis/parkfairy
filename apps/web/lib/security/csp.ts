import { SUPPORTED_LOCALES } from '@parkfairy/contracts/locales';

export interface CspOptions {
  nonce: string;
  /** Next.js dev tooling (React refresh, Turbopack) needs eval. Never true in production. */
  isDev: boolean;
  /** Only meaningful over HTTPS; on plain-http localhost it would break subresource loads. */
  upgradeInsecureRequests: boolean;
  /** Pages with a Mapbox map (`allowsMaps`). Nothing else gets these origins. */
  maps?: boolean;
  /** Pages that take a payment (`allowsPayments`). Nothing else gets Stripe's origins. */
  payments?: boolean;
  /** The booking pass, which registers the worker that keeps it offline (`allowsOfflinePass`). */
  pass?: boolean;
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

/**
 * The page that takes a payment: a booking's (decision #49). Links into it load a real page
 * (`BookingLink`, and the redirect after a hold), as a client navigation keeps the policy of the
 * page it started from.
 */
const PAYMENT_PAGES = new RegExp(`^/(?:${SUPPORTED_LOCALES.join('|')})/bookings/[^/]+/?$`);

export function allowsPayments(pathname: string): boolean {
  return PAYMENT_PAGES.test(pathname);
}

/**
 * A booking's pass (5A.3), the one page that registers a service worker, to be kept for a stay
 * without a connection. Links into it load a real page, as the worker is registered from the page the
 * driver is on, and any other page's policy would refuse it.
 */
const PASS_PAGES = new RegExp(
  `^/(?:${SUPPORTED_LOCALES.join('|')})/bookings/[0-9a-f-]{36}/pass/?$`,
);

export function allowsOfflinePass(pathname: string): boolean {
  return PASS_PAGES.test(pathname);
}

/**
 * Stripe.js and the Payment Element's frames (Stripe's documented list); 3-D Secure challenges
 * frame `hooks.stripe.com`. Under `strict-dynamic` the script hosts matter only to browsers without
 * it: Stripe.js is loaded by our nonce'd code.
 */
const STRIPE_SCRIPTS = ['https://js.stripe.com', 'https://*.js.stripe.com'];
const STRIPE_FRAMES = [
  'https://js.stripe.com',
  'https://*.js.stripe.com',
  'https://hooks.stripe.com',
];
const STRIPE_API = ['https://api.stripe.com', 'https://merchant-ui-api.stripe.com'];

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
  payments = false,
  pass = false,
}: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
      ...(payments ? STRIPE_SCRIPTS : []),
    ],
    // React `style` attributes cannot carry nonces, so inline styles stay allowed; this is
    // the accepted residual risk (style injection), scripts remain locked down.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'blob:', 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(maps ? MAPBOX_ORIGINS : []), ...(payments ? STRIPE_API : [])],
    // What default-src gave frames before, and Stripe's fields on the page that pays.
    'frame-src': ["'self'", ...(payments ? STRIPE_FRAMES : [])],
    // Falling back to script-src would refuse the map's worker: strict-dynamic ignores 'self'.
    // The same for the pass's worker, which the script policy would refuse.
    ...(maps || pass ? { 'worker-src': ["'self'"] } : {}),
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
