import type { Redis } from 'ioredis';

const HOUR_MS = 60 * 60_000;

/**
 * What Mapbox bills the whole site may come to in a clock hour, in its own units: a session of
 * suggestions ending in a pick counts once, whatever number of calls it takes, and a one-off look-up
 * counts once. So a session is counted the first time it is seen, and its later calls are free
 * here, as they are at Mapbox. Each visitor has their own limits besides, but someone with many
 * addresses could still run up the bill, and Mapbox has no spending cap.
 *
 * The clock hour is in the key: a rolling window would stay shut under steady traffic (memory.md).
 * Without Redis, or while it fails, each instance counts its own: the request limits let everything
 * through while Redis is down, so this cap must not.
 */
export class PlacesBudget {
  private memory = { hour: -1, used: 0, sessions: new Set<string>() };

  constructor(
    private readonly limit: number,
    private readonly redis: Pick<Redis, 'incr' | 'pexpire' | 'set'> | null,
    private readonly onError: (error: unknown) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Counts a billed unit, unless `session` was counted already this hour; false once the hour's
   * budget is spent. A session already under way goes on: its unit is spent.
   */
  async spend(session?: string): Promise<boolean> {
    const hour = Math.floor(this.now() / HOUR_MS);
    if (!this.redis) return this.spendHere(hour, session);
    try {
      if (session) {
        const fresh = await this.redis.set(`places:session:${session}`, '1', 'PX', HOUR_MS, 'NX');
        if (fresh === null) return true;
      }
      const key = `places:budget:${hour}`;
      const used = await this.redis.incr(key);
      // Set once, with room to spare: the key is for this hour only.
      if (used === 1) await this.redis.pexpire(key, 2 * HOUR_MS);
      return used <= this.limit;
    } catch (error) {
      this.onError(error);
      return this.spendHere(hour, session);
    }
  }

  private spendHere(hour: number, session?: string): boolean {
    if (this.memory.hour !== hour) this.memory = { hour, used: 0, sessions: new Set() };
    if (session) {
      if (this.memory.sessions.has(session)) return true;
      // Bounded: past the limit nothing new is let through anyway.
      if (this.memory.sessions.size <= this.limit) this.memory.sessions.add(session);
    }
    this.memory.used += 1;
    return this.memory.used <= this.limit;
  }
}
