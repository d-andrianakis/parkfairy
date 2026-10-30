import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberEmail, takeRememberedEmail } from './remembered-email';

describe('remembered email', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('hands the address over once', () => {
    rememberEmail('maria@example.gr');
    expect(takeRememberedEmail()).toBe('maria@example.gr');
    expect(takeRememberedEmail()).toBeNull();
  });

  it('remembers nothing for an empty field', () => {
    rememberEmail('');
    rememberEmail(undefined);
    expect(takeRememberedEmail()).toBeNull();
  });

  it('survives blocked storage: the person just types it again', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberEmail('maria@example.gr')).not.toThrow();
    expect(takeRememberedEmail()).toBeNull();
  });
});
