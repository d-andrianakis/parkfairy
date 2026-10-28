import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { AuthSession, AuthUser } from '@parkfairy/auth';
import type { UserRole } from '@parkfairy/database';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/** Opts a route out of session verification. Every other route requires a valid session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restricts a route to the given platform roles. Admin access additionally
 * requires the account to have two-factor authentication enabled.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  authSession?: AuthSession['session'];
}

/** Injects the session user verified by `AuthGuard`. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) {
    throw new Error('CurrentUser used on a route without an authenticated session');
  }
  return user;
});
