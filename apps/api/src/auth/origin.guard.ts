import {
  ForbiddenException,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests. Browsers always send `Origin`
 * on state-changing requests, so a cookie-bearing unsafe request must come from
 * a trusted origin. Requests without cookies (server-to-server, provider
 * webhooks) are not CSRF-exposed and pass through to their own verification.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly trusted: ReadonlySet<string>;

  constructor(@Inject(ENV) env: Env) {
    this.trusted = new Set(env.trustedOrigins);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method) || !request.headers.cookie) {
      return true;
    }
    const origin = request.headers.origin ?? originOf(request.headers.referer);
    if (origin && this.trusted.has(origin)) {
      return true;
    }
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Request origin is not allowed',
      code: 'INVALID_ORIGIN',
    });
  }
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
