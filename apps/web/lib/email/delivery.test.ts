// @vitest-environment node
import { memoryRateLimitStorage, redisRateLimitStorage, type AuthEmail } from '@parkfairy/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailTransport } from './transport';

vi.mock('server-only', () => ({}));
const { createEmailDelivery, recipientKey, RECIPIENT_LIMITS, SITE_LIMITS } =
  await import('./delivery');

const email: AuthEmail = {
  kind: 'reset-password',
  to: 'Maria@Example.gr',
  locale: 'en',
  url: 'https://parkfairy.example/reset?token=secret',
};

function setup(send: EmailTransport['send'] = () => Promise.resolve()) {
  const work: (() => Promise<void>)[] = [];
  const onFailure = vi.fn<(kind: AuthEmail['kind'], reason: string) => void>();
  const transport = { send: vi.fn(send) };
  const deliver = createEmailDelivery({
    transport,
    limits: memoryRateLimitStorage(),
    schedule: (task) => work.push(task),
    onFailure,
  });
  const flush = async () => {
    for (const task of work.splice(0)) await task();
  };
  return { deliver, flush, transport, onFailure, work };
}

describe('recipientKey', () => {
  it.each([
    ['maria@example.gr', 'maria@example.gr'],
    ['Maria@Example.GR', 'maria@example.gr'],
    ['maria+shop@example.gr', 'maria@example.gr'],
    ['ma.ria@example.gr', 'ma.ria@example.gr'], // dots only mean nothing to Gmail
    ['m.a.ria+x@gmail.com', 'maria@gmail.com'],
    ['maria@googlemail.com', 'maria@gmail.com'],
  ])('%s counts as %s', (address, key) => {
    expect(recipientKey(address)).toBe(key);
  });
});

describe('createEmailDelivery', () => {
  it('returns before anything is sent, so timing says nothing about the account', async () => {
    const { deliver, flush, transport, work } = setup();

    expect(deliver(email)).toBeUndefined();
    expect(work).toHaveLength(1);
    expect(transport.send).not.toHaveBeenCalled();

    await flush();
    expect(transport.send).toHaveBeenCalledOnce();
    expect(transport.send.mock.calls[0]?.[0]).toMatchObject({ to: 'Maria@Example.gr' });
  });

  it('stops at the limit for one recipient, however the address is written', async () => {
    const { deliver, flush, transport, onFailure } = setup();
    const { max } = RECIPIENT_LIMITS['reset-password'];

    for (let i = 0; i < max; i++) deliver(email);
    deliver({ ...email, to: 'maria@example.GR' });
    await flush();

    expect(transport.send).toHaveBeenCalledTimes(max);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('reset-password', 'recipient limit reached');
  });

  it('counts other recipients and other kinds separately', async () => {
    const { deliver, flush, transport } = setup();
    const { max } = RECIPIENT_LIMITS['reset-password'];

    for (let i = 0; i < max; i++) deliver(email);
    deliver({ ...email, to: 'someone@else.gr' });
    deliver({ ...email, kind: 'verify-email' });
    await flush();

    expect(transport.send).toHaveBeenCalledTimes(max + 2);
  });

  it('sends a taken address at most one notice an hour', async () => {
    // Each sign-up attempt with a taken address would otherwise mail its owner.
    expect(RECIPIENT_LIMITS['existing-account']).toEqual({ window: 3600, max: 1 });
    const { deliver, flush, transport } = setup();
    deliver({ ...email, kind: 'existing-account' });
    deliver({ ...email, kind: 'existing-account' });
    await flush();
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it('logs a failed send without the address or the link', async () => {
    const { deliver, flush, onFailure } = setup(() =>
      Promise.reject(new Error('Resend answered 503')),
    );

    deliver(email);
    await expect(flush()).resolves.toBeUndefined();

    expect(onFailure).toHaveBeenCalledExactlyOnceWith('reset-password', 'Resend answered 503');
    expect(JSON.stringify(onFailure.mock.calls)).not.toMatch(/maria|secret/i);
  });

  it('counts one inbox however the address is dressed up', async () => {
    const { deliver, flush, transport } = setup();
    const { max } = RECIPIENT_LIMITS['reset-password'];

    for (let i = 0; i < max + 3; i++) {
      deliver({ ...email, to: `maria+${i}@example.gr` });
    }
    await flush();

    expect(transport.send).toHaveBeenCalledTimes(max);
  });

  it('sends to the address as typed, not the one it counts under', async () => {
    const { deliver, flush, transport } = setup();
    deliver({ ...email, to: 'Maria+Tag@Example.gr' });
    await flush();
    expect(transport.send.mock.calls[0]?.[0]).toMatchObject({ to: 'Maria+Tag@Example.gr' });
  });

  it('stops at the site budget, kind by kind, so sign-up floods leave resets alone', async () => {
    const { deliver, flush, transport, onFailure } = setup();
    const { max } = SITE_LIMITS['existing-account'];

    for (let i = 0; i < max + 2; i++) {
      deliver({ ...email, kind: 'existing-account', to: `person${i}@example.gr` });
    }
    deliver({ ...email, to: 'someone@else.gr' });
    await flush();

    expect(transport.send).toHaveBeenCalledTimes(max + 1);
    expect(onFailure).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledWith('existing-account', 'site limit reached');
  });

  it('opens the site budget again each hour, however steady the traffic', async () => {
    // The store's window is rolling: one key would stay shut while mail keeps flowing.
    vi.useFakeTimers({ now: new Date('2026-10-30T10:30:00Z'), toFake: ['Date'] });
    try {
      const { deliver, flush, transport } = setup();
      const { max } = SITE_LIMITS['existing-account'];
      const flood = async (hour: string) => {
        for (let i = 0; i < max + 1; i++) {
          deliver({ ...email, kind: 'existing-account', to: `${hour}-${i}@example.gr` });
        }
        await flush();
      };

      await flood('first');
      expect(transport.send).toHaveBeenCalledTimes(max);

      vi.setSystemTime(new Date('2026-10-30T11:00:00Z'));
      await flood('second');
      expect(transport.send).toHaveBeenCalledTimes(max * 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not spend the site budget on emails the recipient cap drops', async () => {
    const limits = memoryRateLimitStorage();
    const consume = vi.spyOn(limits, 'consume');
    const work: (() => Promise<void>)[] = [];
    const deliver = createEmailDelivery({
      transport: { send: () => Promise.resolve() },
      limits,
      schedule: (task) => work.push(task),
      onFailure: () => {},
    });

    deliver({ ...email, kind: 'existing-account' });
    deliver({ ...email, kind: 'existing-account' });
    for (const task of work) await task();

    const siteChecks = consume.mock.calls.filter(([key]) => key.includes(':hour:'));
    expect(siteChecks).toHaveLength(1);
  });

  it('keeps sending and counting while Redis is down', async () => {
    const send = vi.fn(() => Promise.resolve());
    const down = () => Promise.reject(new Error('ECONNREFUSED'));
    const work: (() => Promise<void>)[] = [];
    const deliver = createEmailDelivery({
      transport: { send },
      limits: redisRateLimitStorage({ eval: down, evalsha: down }, () => {}),
      schedule: (task) => work.push(task),
      onFailure: () => {},
    });
    const { max } = RECIPIENT_LIMITS['reset-password'];

    for (let i = 0; i < max + 2; i++) deliver(email);
    for (const task of work) await task();

    expect(send).toHaveBeenCalledTimes(max);
  });

  it('uses up the allowance on a failed send: the cap is on attempts', async () => {
    const { deliver, flush, transport } = setup(() => Promise.reject(new Error('Resend down')));
    const { max } = RECIPIENT_LIMITS['reset-password'];

    for (let i = 0; i < max + 1; i++) deliver(email);
    await flush();

    expect(transport.send).toHaveBeenCalledTimes(max);
  });

  describe('by default', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('logs the kind and the reason, not the address or the link', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const work: (() => Promise<void>)[] = [];
      const deliver = createEmailDelivery({
        transport: { send: () => Promise.reject(new Error('Resend answered 503')) },
        limits: memoryRateLimitStorage(),
        schedule: (task) => work.push(task),
      });

      deliver(email);
      await work[0]?.();

      expect(log).toHaveBeenCalledExactlyOnceWith('Email not delivered', {
        kind: 'reset-password',
        reason: 'Resend answered 503',
      });
    });
  });

  it('survives a rate-limit store that fails', async () => {
    const onFailure = vi.fn();
    const work: (() => Promise<void>)[] = [];
    const deliver = createEmailDelivery({
      transport: { send: () => Promise.resolve() },
      limits: { consume: () => Promise.reject(new Error('store down')) },
      schedule: (task) => work.push(task),
      onFailure,
    });
    deliver(email);
    await expect(work[0]?.()).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledWith('reset-password', 'store down');
  });
});
