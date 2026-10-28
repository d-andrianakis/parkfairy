import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { AUTH_COOKIE_PREFIX } from '@parkfairy/auth';
import { addContractSchemas } from './zod-openapi.js';

export const SESSION_COOKIE_SECURITY = 'session';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Parkfairy API')
    .setDescription('Parking marketplace REST API. Browsers reach it same-origin via /api.')
    .setVersion('1')
    .addCookieAuth(
      `${AUTH_COOKIE_PREFIX}.session_token`,
      { type: 'apiKey', in: 'cookie' },
      SESSION_COOKIE_SECURITY,
    )
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
  return addContractSchemas(document);
}
