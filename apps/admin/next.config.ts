import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Development shares the repo-root .env with the API, worker and web app. Variables already set
// in the environment (CI, hosting) take precedence over the file.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

// The Content-Security-Policy is per-request (nonce) and therefore set in proxy.ts.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Staff screens link nowhere outside, and a referrer would carry listing ids.
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  // Nothing here is for search engines or shared caches: owners' names, tax endings, audit lines.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  // A page on another origin must not be able to open staff screens in a window it controls.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@parkfairy/ui', '@parkfairy/api-client'],
  // What `next-intl/plugin` would configure (see the web app's note on why the plugin is unused).
  turbopack: {
    resolveAlias: { 'next-intl/config': './i18n/request.ts' },
  },
  experimental: { globalNotFound: true },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Everything but Next's own assets, which are fingerprinted and get a year from Next.
      {
        source: '/((?!_next/).*)',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
  async rewrites() {
    // Browsers call the API same-origin so the session cookie is sent as-is. Only the staff routes:
    // a script bug on this origin must not get the rest of the API (bookings, owner, webhooks).
    return [{ source: '/api/v1/admin/:path*', destination: `${apiUrl}/v1/admin/:path*` }];
  },
};

export default nextConfig;
