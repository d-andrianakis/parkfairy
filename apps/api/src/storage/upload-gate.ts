import { HttpException, Injectable } from '@nestjs/common';

/** Uploads being read or processed in this process, at 10 MB each at most. */
const MAX_UPLOADS = 16;
/** The page sends one at a time, so a second is a retry and a third is something else. */
const MAX_UPLOADS_PER_USER = 2;
/** Each resize takes threads from the pool that DNS, files and session checks also need. */
const IMAGE_SLOTS = 2;

function busy(): HttpException {
  return new HttpException(
    {
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'UPLOADS_BUSY',
      code: 'UPLOADS_BUSY',
    },
    503,
  );
}

/**
 * What uploads may cost this process at once. The route's rate limit counts requests started per
 * minute, not what is in flight, so a handful of small, crafted files could otherwise fill memory
 * and starve the thread pool the public catalogue relies on.
 */
@Injectable()
export class UploadGate {
  private total = 0;
  private readonly byUser = new Map<string, number>();
  private processing = 0;
  private readonly waiting: (() => void)[] = [];

  /** Takes a place for one upload, or refuses; the function given back gives it up. */
  admit(userId: string): () => void {
    const mine = this.byUser.get(userId) ?? 0;
    if (this.total >= MAX_UPLOADS || mine >= MAX_UPLOADS_PER_USER) throw busy();
    this.total++;
    this.byUser.set(userId, mine + 1);
    let left = false;
    return () => {
      if (left) return;
      left = true;
      this.total--;
      const remaining = (this.byUser.get(userId) ?? 1) - 1;
      if (remaining === 0) this.byUser.delete(userId);
      else this.byUser.set(userId, remaining);
    };
  }

  /** Runs image work in one of the few slots, waiting for one if need be. */
  async process<T>(work: () => Promise<T>): Promise<T> {
    if (this.processing >= IMAGE_SLOTS) {
      // The slot passes straight to the waiter, so `processing` stays as it is.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.processing++;
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.processing--;
    }
  }
}
