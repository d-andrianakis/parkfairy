import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** Injection token for the `ObjectStore`. */
export const OBJECT_STORE = Symbol('OBJECT_STORE');

/**
 * Where uploads live. Keys are always built by the API. `photos/` is public through the media
 * route, `proofs/` is private: nothing but the owner's own download route reads it, so the
 * bucket itself stays closed to the internet either way.
 */
export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** The file, or null when there is none. */
  get(key: string): Promise<Buffer | null>;
  delete(keys: string[]): Promise<void>;
}

const KEY = /^[a-z0-9]+(?:\/[a-z0-9-]+)*(?:\.[a-z0-9]+)?$/;

function assertKey(key: string): void {
  // Last line of defence: every caller builds keys from validated parts.
  if (!KEY.test(key)) throw new Error('Invalid object key');
}

/**
 * Files on this machine, for local work and the smoke suite: `loadEnv` allows it only on a
 * loopback origin, as with emails. The rename makes a file appear complete.
 */
export function fileObjectStore(directory: string): ObjectStore {
  const path = (key: string) => {
    assertKey(key);
    return join(directory, ...key.split('/'));
  };
  return {
    async put(key, body) {
      const target = path(key);
      await mkdir(dirname(target), { recursive: true });
      const partial = `${target}.${randomUUID()}.partial`;
      await writeFile(partial, body);
      await rename(partial, target);
    },
    async get(key) {
      try {
        return await readFile(path(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(keys) {
      await Promise.all(keys.map((key) => rm(path(key), { force: true })));
    },
  };
}

/** S3's limit on one delete request. */
const DELETE_BATCH = 1000;

/** S3 or anything that speaks it. Credentials come from the SDK's usual environment chain. */
export function s3ObjectStore({
  bucket,
  region,
  endpoint,
  client = new S3Client({ region, endpoint, forcePathStyle: Boolean(endpoint) }),
}: {
  bucket: string;
  region: string;
  /** For S3-compatible stores; omit for AWS. */
  endpoint?: string | undefined;
  client?: Pick<S3Client, 'send'>;
}): ObjectStore {
  return {
    async put(key, body, contentType) {
      assertKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ServerSideEncryption: 'AES256',
        }),
      );
    },
    async get(key) {
      assertKey(key);
      try {
        const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return Body ? Buffer.from(await Body.transformToByteArray()) : null;
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
    async delete(keys) {
      keys.forEach(assertKey);
      for (let from = 0; from < keys.length; from += DELETE_BATCH) {
        const { Errors } = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.slice(from, from + DELETE_BATCH).map((Key) => ({ Key })) },
          }),
        );
        // S3 answers 200 and lists what it couldn't delete: private documents must not linger.
        if (Errors?.length) throw new Error(`S3 kept ${Errors.length} of the files to delete`);
      }
    },
  };
}
