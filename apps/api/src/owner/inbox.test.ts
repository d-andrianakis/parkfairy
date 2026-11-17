import { describe, expect, it } from 'vitest';

import { inboxOfAddress } from './listing-owners.service.js';

describe('inboxOfAddress', () => {
  it.each([
    ['a@example.com', 'a@example.com'],
    ['a+1@example.com', 'a@example.com'],
    ['a+b+c@example.com', 'a@example.com'],
    ['a+@example.com', 'a@example.com'],
    // Only the part before the last @ is a name: a tag in the domain part isn't one.
    ['a@ex+ample.com', 'a@ex+ample.com'],
    ['not-an-address', 'not-an-address'],
  ])('reads %s as %s', (address, inbox) => {
    expect(inboxOfAddress(address)).toBe(inbox);
  });
});
