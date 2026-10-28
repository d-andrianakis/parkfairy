import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthResponseSchema, type HealthResponse } from '@parkfairy/contracts';
import type { Database } from '@parkfairy/database';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/auth.decorators.js';
import { DB } from '../database/database.module.js';
import { schemaRef } from '../openapi/zod-openapi.js';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Liveness: the process is up and serving requests. */
  @Get()
  @ApiOkResponse({ schema: schemaRef(HealthResponseSchema) })
  getLiveness(): HealthResponse {
    return { status: 'ok' };
  }

  /** Readiness: dependencies required to serve traffic are reachable. */
  @Get('ready')
  @ApiOkResponse({ schema: schemaRef(HealthResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: schemaRef(HealthResponseSchema) })
  async getReadiness(): Promise<HealthResponse> {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok', checks: { database: 'up' } };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', checks: { database: 'down' } });
    }
  }
}
