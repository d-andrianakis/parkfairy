import { describe, expect, it, vi } from 'vitest';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

describe('RedisThrottlerStorage', () => {
  it('converts the script’s milliseconds to the seconds the guard expects', async () => {
    const evalsha = vi.fn().mockResolvedValue([121, 42_100, 1, 59_001]);
    const storage = new RedisThrottlerStorage({ eval: vi.fn(), evalsha }, vi.fn());
    await expect(storage.increment('abc', 60_000, 120, 60_000, 'default')).resolves.toEqual({
      totalHits: 121,
      timeToExpire: 43,
      isBlocked: true,
      timeToBlockExpire: 60,
    });
    expect(evalsha).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]{40}$/),
      2,
      // One hash tag: both keys in the same Redis Cluster slot.
      'throttle:{default:abc}:hits',
      'throttle:{default:abc}:blocked',
      60_000,
      120,
      60_000,
    );
  });

  it('lets requests through when Redis fails, reporting at most every 10 s', async () => {
    const onError = vi.fn();
    const storage = new RedisThrottlerStorage(
      { eval: vi.fn(), evalsha: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
      onError,
    );
    for (let i = 0; i < 5; i++) {
      await expect(storage.increment('abc', 60_000, 120, 60_000, 'default')).resolves.toMatchObject(
        { isBlocked: false },
      );
    }
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'ECONNREFUSED' }), 0);
  });
});
