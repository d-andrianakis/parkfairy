import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { buildOpenApiDocument } from './openapi/document.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const env = app.get<Env>(ENV);
  if (!env.isProduction) {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
  }

  await app.listen(env.API_PORT);
  app.get(Logger).log(`API listening on http://localhost:${env.API_PORT}`, 'Bootstrap');
}

void bootstrap();
