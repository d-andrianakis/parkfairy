import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../auth/auth.decorators.js';

/**
 * Answers that need a session are someone's own: a booking with its plate, an owner's list of who
 * is coming. `private, no-store`, so no shared cache (a CDN in front at launch, a proxy on the way)
 * keeps one person's answer for another. Public routes keep their own caching, and a route that
 * sets `Cache-Control` itself (`@Header`) has the last word.
 */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isPublic && context.getType() === 'http') {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('Cache-Control', 'private, no-store');
    }
    return next.handle();
  }
}
