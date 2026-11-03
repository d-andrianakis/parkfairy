import { Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { createFieldCrypto, fieldKey } from './field-crypto.js';
import { FIELD_CRYPTO } from './field-crypto.provider.js';
import { OwnerController } from './owner.controller.js';
import { OwnerListingsService } from './owner-listings.service.js';
import { OwnerProfileService } from './owner-profile.service.js';

@Module({
  controllers: [OwnerController],
  providers: [
    OwnerProfileService,
    OwnerListingsService,
    {
      provide: FIELD_CRYPTO,
      inject: [ENV],
      useFactory: (env: Env) =>
        createFieldCrypto(fieldKey(env.OWNER_DATA_KEY, env.BETTER_AUTH_SECRET)),
    },
  ],
})
export class OwnerModule {}
