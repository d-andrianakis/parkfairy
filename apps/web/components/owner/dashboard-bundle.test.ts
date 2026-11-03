import { expect, it, vi } from 'vitest';

// Zod probes for eval as its schemas are built, which the CSP reports. Forms turn that off first
// (lib/zod-jitless); the dashboard has none, so all it needs is not to load zod at all.
vi.mock('zod', () => {
  throw new Error('zod was loaded');
});

it('keeps zod out of the dashboard’s client code', async () => {
  await expect(import('./listing-actions')).resolves.toBeDefined();
  await expect(import('./navigation')).resolves.toBeDefined();
});
