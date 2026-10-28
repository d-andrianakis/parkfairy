/**
 * Writes the OpenAPI document to disk without starting the HTTP server:
 * `node dist/openapi/emit.js <output.json>`. The generated client is built from it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { buildOpenApiDocument } from './document.js';

const output = resolve(process.argv[2] ?? 'openapi.json');

const app = await NestFactory.create(AppModule, {
  logger: ['error'],
  abortOnError: false,
  bodyParser: false,
});
configureApp(app);
const document = buildOpenApiDocument(app);
await app.close();

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
console.log(`OpenAPI document written to ${output}`);
