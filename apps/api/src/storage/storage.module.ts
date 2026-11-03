import { Global, Module } from '@nestjs/common';
import { ConfigModule, ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { MediaController } from './media.controller.js';
import { fileObjectStore, OBJECT_STORE, s3ObjectStore } from './object-store.js';
import { UploadGate } from './upload-gate.js';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [MediaController],
  providers: [
    UploadGate,
    {
      provide: OBJECT_STORE,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.S3_BUCKET
          ? s3ObjectStore({
              bucket: env.S3_BUCKET,
              region: env.S3_REGION,
              endpoint: env.S3_ENDPOINT,
            })
          : fileObjectStore(env.objectStoreDir),
    },
  ],
  exports: [OBJECT_STORE, UploadGate],
})
export class StorageModule {}
