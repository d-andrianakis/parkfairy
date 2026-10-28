import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './safe-redirect';

describe('safeRedirectPath', () => {
  it.each(['/account', '/account?tab=bookings', '/sign-in#top'])(
    'keeps the relative path %s',
    (path) => {
      expect(safeRedirectPath(path)).toBe(path);
    },
  );

  it.each([
    ['protocol-relative URL', '//evil.example/phish'],
    ['backslash trick', '/\\evil.example'],
    ['absolute URL', 'https://evil.example'],
    ['javascript URL', 'javascript:alert(1)'],
    ['relative without slash', 'account'],
    ['empty', ''],
  ])('falls back on a %s', (_label, value) => {
    expect(safeRedirectPath(value)).toBe('/account');
  });

  it('uses the provided fallback', () => {
    expect(safeRedirectPath(undefined, '/')).toBe('/');
  });
});
