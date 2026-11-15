import { afterEach, describe, expect, it } from 'vitest';
import { accountPageUrl } from './site';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('where staff turn on a second factor', () => {
  const env = {
    DATABASE_URL: 'postgres://u:p@localhost:5434/db',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    ADMIN_URL: 'http://localhost:3001',
  };

  it('is the public site’s account page, in the language asked', () => {
    Object.assign(process.env, env, { BETTER_AUTH_URL: 'https://parkfairy.gr' });
    expect(accountPageUrl('el')).toBe('https://parkfairy.gr/el/account');
    expect(accountPageUrl('en')).toBe('https://parkfairy.gr/en/account');
  });

  it('does not depend on a trailing slash or a path in the site’s address', () => {
    Object.assign(process.env, env, { BETTER_AUTH_URL: 'http://localhost:3000/some/' });
    expect(accountPageUrl('en')).toBe('http://localhost:3000/en/account');
  });
});
