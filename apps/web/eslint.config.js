import { nextConfig } from '@parkfairy/config/eslint/next';

// The map's worker, copied there from the package at build time.
export default [{ ignores: ['public/vendor/**'] }, ...nextConfig];
