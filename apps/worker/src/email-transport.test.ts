import { outboxTransport, resendTransport } from '@parkfairy/email';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseEmailTransport } from './email-transport.js';

vi.mock('@parkfairy/email', () => ({
  outboxTransport: vi.fn(() => 'files'),
  resendTransport: vi.fn(() => 'resend'),
}));

const unset = {
  RESEND_API_KEY: undefined,
  EMAIL_FROM: undefined,
  EMAIL_OUTBOX_DIR: undefined,
  EMAIL_SENDS_PER_SECOND: 1,
};

describe('chooseEmailTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('really sends when it has a key and a sender, at the pace it is given', () => {
    const env = { ...unset, RESEND_API_KEY: 'k', EMAIL_FROM: 'hello@parkfairy.gr' };
    expect(chooseEmailTransport(env)).toBe('resend');
    expect(resendTransport).toHaveBeenCalledWith({
      apiKey: 'k',
      from: 'hello@parkfairy.gr',
      intervalMs: 1000,
    });
    expect(outboxTransport).not.toHaveBeenCalled();
    chooseEmailTransport({ ...env, EMAIL_SENDS_PER_SECOND: 3 });
    expect(resendTransport).toHaveBeenLastCalledWith(expect.objectContaining({ intervalMs: 334 }));
    chooseEmailTransport({ ...env, EMAIL_SENDS_PER_SECOND: 0.5 });
    expect(resendTransport).toHaveBeenLastCalledWith(expect.objectContaining({ intervalMs: 2000 }));
  });

  it('writes files to the directory it is told', () => {
    expect(chooseEmailTransport({ ...unset, EMAIL_OUTBOX_DIR: '/tmp/mail' })).toBe('files');
    expect(outboxTransport).toHaveBeenCalledWith('/tmp/mail');
  });

  it('writes files beside the repository otherwise, where the smoke suite reads them', () => {
    chooseEmailTransport(unset);
    expect(vi.mocked(outboxTransport).mock.calls[0]?.[0]).toMatch(/\.emails$/);
    expect(resendTransport).not.toHaveBeenCalled();
  });
});
