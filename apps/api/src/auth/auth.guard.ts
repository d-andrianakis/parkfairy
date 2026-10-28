import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Auth } from '@parkfairy/auth';
import type { UserRole } from '@parkfairy/database';
import { fromNodeHeaders } from 'better-auth/node';
import { IS_PUBLIC_KEY, ROLES_KEY, type AuthenticatedRequest } from './auth.decorators.js';
import { AUTH } from './auth.tokens.js';

/**
 * Global guard: every route requires a valid Better Auth session unless marked
 * `@Public()`. Sessions are looked up in the database on every request so
 * revocations and role changes take effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const result = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      // The web app owns sliding-expiry refresh; the API cannot return the updated cookie.
      query: { disableRefresh: true },
    });
    if (!result) {
      throw new UnauthorizedException();
    }
    request.user = result.user;
    request.authSession = result.session;

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (roles?.length) {
      const { role } = result.user;
      if (!roles.includes(role)) {
        throw new ForbiddenException();
      }
      if (role === 'admin' && !result.user.twoFactorEnabled) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Two-factor authentication is required for administrator access',
          code: 'MFA_REQUIRED',
        });
      }
    }
    return true;
  }
}
