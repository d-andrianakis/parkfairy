export interface CspOptions {
  nonce: string;
  /** Next.js dev tooling (React refresh, Turbopack) needs eval. Never true in production. */
  isDev: boolean;
  /** Only meaningful over HTTPS; on plain-http localhost it would break subresource loads. */
  upgradeInsecureRequests: boolean;
}

/**
 * Strict, nonce-based Content-Security-Policy for the staff screens (#66: their own origin and
 * policy). Nothing third-party is ever allowed here, no maps, payments or analytics: a page that
 * shows owners' details must not be able to send them anywhere. Next.js reads the nonce from the
 * request's CSP header and applies it to its own scripts; `strict-dynamic` lets those load chunks.
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
    // React `style` attributes cannot carry nonces, so inline styles stay allowed; scripts do not.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'frame-src': ["'none'"],
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
