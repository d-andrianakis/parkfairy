import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { AuthUser } from '@parkfairy/auth';
import { ErrorResponseSchema, MeResponseSchema, type MeResponse } from '@parkfairy/contracts';
import { CurrentUser } from '../auth/auth.decorators.js';
import { SESSION_COOKIE_SECURITY } from '../openapi/document.js';
import { schemaRef } from '../openapi/zod-openapi.js';

@ApiTags('users')
@ApiCookieAuth(SESSION_COOKIE_SECURITY)
@ApiUnauthorizedResponse({ schema: schemaRef(ErrorResponseSchema) })
@Controller('me')
export class UsersController {
  /** Returns the signed-in user as verified by the API from the session cookie. */
  @Get()
  @ApiOkResponse({ schema: schemaRef(MeResponseSchema) })
  getMe(@CurrentUser() user: AuthUser): MeResponse {
    // Parsing through the contract strips any field that is not part of the public shape.
    return MeResponseSchema.parse({
      ...user,
      twoFactorEnabled: user.twoFactorEnabled ?? false,
      createdAt: user.createdAt.toISOString(),
    });
  }
}
