import { type INestApplication, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { raw } from 'express';
import helmet from 'helmet';

import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { STRIPE_WEBHOOK_PATH } from './payments/stripe-webhook.controller.js';

/**
 * HTTP configuration shared by the server entry point, the OpenAPI emitter and
 * the integration tests, so all three see identical routing and security setup.
 */
export function configureApp(app: INestApplication): INestApplication {
  const env = app.get<Env>(ENV);
  const express = app as NestExpressApplication;

  express.set('trust proxy', env.trustProxy);
  express.disable('x-powered-by');
  // Stripe signs the exact bytes it sends: its webhook keeps them, before the JSON parser could.
  express.use(STRIPE_WEBHOOK_PATH, raw({ type: 'application/json', limit: '256kb' }));
  express.useBodyParser('json', { limit: '100kb' });
  express.useBodyParser('urlencoded', { limit: '100kb', extended: false });
  app.use(helmet());

  // Browsers normally reach the API same-origin through the web app's /api proxy.
  // Credentialed CORS is only enabled when the API is exposed on its own origin.
  if (env.corsOrigins.length > 0) {
    app.enableCors({ origin: env.corsOrigins, credentials: true });
  }

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  return app;
}
