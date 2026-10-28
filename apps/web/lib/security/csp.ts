export interface CspOptions {
  nonce: string;
  /** Next.js dev tooling (React refresh, Turbopack) needs eval. Never true in production. */
  isDev: boolean;
  /** Only meaningful over HTTPS; on plain-http localhost it would break subresource loads. */
  upgradeInsecureRequests: boolean;
}

/**
 * Strict, nonce-based Content-Security-Policy. Next.js reads the nonce from the request's
 * CSP header and applies it to its own scripts; `strict-dynamic` lets those scripts load
 * their chunks. Any third-party origin (maps, payments) must be added here deliberately.
 */
export function buildContentSecurityPolicy({
  nonce,
  isDev,
  upgradeInsecureRequests,
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
    'connect-src': ["'self'"],
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
