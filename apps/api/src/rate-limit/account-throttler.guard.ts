import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * A route's limits again, counted per account rather than per address (L2): someone with many
 * addresses gets no more holds than one. Put it on a route with `@UseGuards`, which runs after the
 * global guards, so the session is known by then; the global throttler can't do this, as it runs
 * first so that a flood never reaches the session lookup. Its counts are keyed apart from the
 * per-address ones, under the same names and limits.
 */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(request: Record<string, unknown>): Promise<string> {
    const user = request.user as { id?: unknown } | undefined;
    if (typeof user?.id === 'string') return `account:${user.id}`;
    return super.getTracker(request);
  }
}
