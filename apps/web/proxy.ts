import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { buildContentSecurityPolicy, createNonce } from './lib/security/csp';

const handleI18nRouting = createIntlMiddleware(routing);

/**
 * The whole owner area, not just the location step: moving between its pages doesn't load a new
 * document, so the policy in force is that of the page the owner arrived on. From outside the
 * area the links to the location step load a real page (`StepLink`), or the map would be refused.
 */
const OWNER_AREA = /^\/(?:el|en)\/owner(?:\/|$)/;

/**
 * Runs for every page request: negotiates the locale (redirecting `/` to `/el` or `/en`)
 * and attaches a per-request CSP nonce. next-intl forwards the request headers we set
 * here to rendering, which is how Next.js finds the nonce for its scripts.
 */
export default function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === 'development',
    upgradeInsecureRequests:
      request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
    maps: OWNER_AREA.test(request.nextUrl.pathname),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = handleI18nRouting(new NextRequest(request, { headers: requestHeaders }));
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  // Pages only: skip API routes (/api/auth, /api/v1), Next internals and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
