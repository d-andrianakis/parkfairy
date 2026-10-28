import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Development shares the repo-root .env with the API and worker. Variables already set
// in the environment (CI, hosting) take precedence over the file.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

// The Content-Security-Policy is per-request (nonce) and therefore set in proxy.ts.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  // Browsers ignore HSTS on plain-http responses, so sending it always is safe.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@parkfairy/ui', '@parkfairy/api-client'],
  // What `next-intl/plugin` would configure. The plugin itself is not used because it eagerly
  // loads @swc/core (for message extraction we don't use), whose native binary refuses to
  // load on some Windows hosts. See memory.md.
  turbopack: {
    resolveAlias: { 'next-intl/config': './i18n/request.ts' },
  },
  experimental: {
    // The root layout sits under [locale], so 404s need app/global-not-found.tsx to be
    // server-rendered (otherwise the 404 HTML is an empty shell filled in by the client).
    globalNotFound: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    // Browsers call the API same-origin so the Better Auth session cookie is sent as-is.
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/v1/:path*` }];
  },
};

export default nextConfig;
