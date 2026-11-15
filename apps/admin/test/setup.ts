import '@parkfairy/ui/testing/setup';
import { beforeEach, vi } from 'vitest';
import { routerMock } from './navigation-mock';

// Components use the locale-aware navigation from next-intl, which needs the Next.js app
// router at runtime. Tests swap it for a lightweight stand-in (see navigation-mock.tsx).
vi.mock('@/i18n/navigation', () => import('./navigation-mock'));
// Server modules guard against client bundles with it; pages render here under test.
vi.mock('server-only', () => ({}));

beforeEach(() => {
  for (const fn of Object.values(routerMock)) fn.mockClear();
});
