import { createHash } from 'node:crypto';
import { ForbiddenException, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';

const HOUR_MS = 60 * 60_000;
/**
 * Calls one visitor may make in an hour, all three routes together: about fifteen
 * addresses typed and picked. A twentieth of the site's hourly budget, so one client can't spend it
 * and switch address search off for everyone (security review, 3.2).
 */
export const PLACES_PER_VISITOR_HOUR = 100;

/**
 * Two things the per-route limits can't do for address search:
 * - refuse requests another site's page makes from a visitor's browser (`Sec-Fetch-Site`): an
 *   `<img>` pointing here would spend our budget from every visitor's own address. Requests without
 *   the header (the web server's own, older browsers) and typed into the address bar (`none`) pass;
 * - cap each visitor per hour across the routes, under one key the handler's name isn't part of.
 */
@Injectable()
export class PlacesVisitorGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const site = request.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'CROSS_SITE',
        code: 'CROSS_SITE',
      });
    }
    return super.canActivate(context);
  }

  protected override handleRequest(request: ThrottlerRequest): Promise<boolean> {
    return super.handleRequest({
      ...request,
      limit: PLACES_PER_VISITOR_HOUR,
      ttl: HOUR_MS,
      blockDuration: HOUR_MS,
    });
  }

  protected override generateKey(_context: ExecutionContext, tracker: string, name: string) {
    return createHash('sha256').update(`places-hour-${name}-${tracker}`).digest('hex');
  }
}
