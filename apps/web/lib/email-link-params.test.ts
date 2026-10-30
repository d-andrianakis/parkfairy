import { describe, expect, it } from 'vitest';
import { usableToken } from './email-link-params';

describe('usableToken', () => {
  it('returns the token of a working link', () => {
    expect(usableToken({ token: 'abc' })).toBe('abc');
  });

  it.each([
    ['no parameters', {}],
    ['an empty token', { token: '' }],
    ['a repeated token', { token: ['a', 'b'] }],
    ['an error from Better Auth', { token: 'abc', error: 'INVALID_TOKEN' }],
    ['an empty error', { token: 'abc', error: '' }],
    ['only an error', { error: 'INVALID_TOKEN' }],
  ])('treats %s as a dead link', (_, params) => {
    expect(usableToken(params)).toBeNull();
  });
});
