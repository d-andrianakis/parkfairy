import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetEverySentTo,
  forgetSentTo,
  recallSentTo,
  rememberEmail,
  rememberSentTo,
  takeRememberedEmail,
} from './remembered-email';

describe('address a form was sent to', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('is kept per page until forgotten', () => {
    expect(rememberSentTo('/sign-up', 'maria@example.gr')).toBe(true);
    expect(recallSentTo('/sign-up')).toBe('maria@example.gr');
    expect(recallSentTo('/forgot-password')).toBeNull();

    forgetSentTo('/sign-up');
    expect(recallSentTo('/sign-up')).toBeNull();
  });

  it('goes for every page at once, leaving other entries alone', () => {
    rememberSentTo('/sign-up', 'maria@example.gr');
    rememberSentTo('/forgot-password', 'maria@example.gr');
    rememberEmail('typed@example.gr');

    forgetEverySentTo();

    expect(recallSentTo('/sign-up')).toBeNull();
    expect(recallSentTo('/forgot-password')).toBeNull();
    expect(takeRememberedEmail()).toBe('typed@example.gr');
  });

  it('survives blocked storage when forgetting: sign-in and sign-out must go on', () => {
    rememberSentTo('/sign-up', 'maria@example.gr');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => forgetEverySentTo()).not.toThrow();
    expect(() => forgetSentTo('/sign-up')).not.toThrow();
  });

  it('says when it could not be kept', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(rememberSentTo('/sign-up', 'maria@example.gr')).toBe(false);
  });
});

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
