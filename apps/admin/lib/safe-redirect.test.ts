import { describe, expect, it } from 'vitest';

import { safeRedirectPath } from './safe-redirect';

describe('where a signed-in person may be sent', () => {
  it('keeps paths on this site, with their query', () => {
    expect(safeRedirectPath('/listings')).toBe('/listings');
    expect(safeRedirectPath('/audit?action=listing.approved')).toBe(
      '/audit?action=listing.approved',
    );
    expect(safeRedirectPath('/listings/7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f')).toBe(
      '/listings/7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f',
    );
  });

  it('falls back to the queue for nothing, or for anything that is not a path', () => {
    for (const value of [
      undefined,
      null,
      '',
      'listings',
      'https://evil.example',
      'javascript:alert(1)',
    ]) {
      expect(safeRedirectPath(value), String(value)).toBe('/listings');
    }
    expect(safeRedirectPath(undefined, '/audit')).toBe('/audit');
  });

  it('refuses what a browser reads as another host', () => {
    for (const value of [
      '//evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      '/%2f/evil.example'.replace('%2f', '\u0000'),
      '/listings\\..\\x',
    ]) {
      expect(safeRedirectPath(value), JSON.stringify(value)).toBe('/listings');
    }
  });

  it('refuses the API, which is no page', () => {
    expect(safeRedirectPath('/api')).toBe('/listings');
    expect(safeRedirectPath('/api/v1/admin/listings')).toBe('/listings');
    expect(safeRedirectPath('/apiary')).toBe('/apiary');
  });

  it('drops a language prefix, which the router puts back, so there is only one', () => {
    expect(safeRedirectPath('/el/listings')).toBe('/listings');
    expect(safeRedirectPath('/en/audit?action=x')).toBe('/audit?action=x');
    expect(safeRedirectPath('/en')).toBe('/');
    expect(safeRedirectPath('/english')).toBe('/english');
    expect(safeRedirectPath('/el//evil.example')).toBe('/listings');
  });
});
