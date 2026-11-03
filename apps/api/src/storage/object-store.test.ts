import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type DeleteObjectsCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileObjectStore, s3ObjectStore, type ObjectStore } from './object-store.js';

describe('fileObjectStore', () => {
  let directory: string;
  let store: ObjectStore;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'parkfairy-store-'));
    store = fileObjectStore(directory);
  });
  afterAll(() => rm(directory, { recursive: true, force: true }));

  it('stores, reads and deletes a file under its key', async () => {
    await store.put('photos/abc/480.webp', Buffer.from('one'), 'image/webp');
    expect((await store.get('photos/abc/480.webp'))?.toString()).toBe('one');
    await store.delete(['photos/abc/480.webp']);
    expect(await store.get('photos/abc/480.webp')).toBeNull();
  });

  it('answers null for a file that was never stored', async () => {
    expect(await store.get('photos/none/480.webp')).toBeNull();
  });

  it('leaves no partial files behind', async () => {
    await store.put('photos/def/480.webp', Buffer.from('two'), 'image/webp');
    expect(await readdir(join(directory, 'photos', 'def'))).toEqual(['480.webp']);
    expect(await readFile(join(directory, 'photos', 'def', '480.webp'), 'utf8')).toBe('two');
  });

  it.each(['../secret', 'photos/../../secret', '/etc/passwd', 'photos\\x', 'a//b', ''])(
    'refuses the key %j',
    async (key) => {
      await expect(store.get(key)).rejects.toThrow('Invalid object key');
      await expect(store.put(key, Buffer.from('x'), 'text/plain')).rejects.toThrow(
        'Invalid object key',
      );
    },
  );
});

describe('s3ObjectStore', () => {
  const setup = (send = vi.fn()) => ({
    send,
    store: s3ObjectStore({ bucket: 'b', region: 'eu', client: { send } }),
  });

  it('writes with server-side encryption, in the named bucket', async () => {
    const { send, store } = setup();
    await store.put('proofs/a/b', Buffer.from('x'), 'application/pdf');
    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'b',
      Key: 'proofs/a/b',
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
    });
  });

  it('reads a file', async () => {
    const body = { transformToByteArray: () => Promise.resolve(new Uint8Array([104, 105])) };
    const { send, store } = setup(vi.fn().mockResolvedValue({ Body: body }));
    expect((await store.get('photos/a/480.webp'))?.toString()).toBe('hi');
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
  });

  it('answers null for a missing file and rethrows anything else', async () => {
    const missing = new NoSuchKey({ message: 'gone', $metadata: {} });
    await expect(
      setup(vi.fn().mockRejectedValue(missing)).store.get('photos/a/480.webp'),
    ).resolves.toBeNull();
    await expect(
      setup(vi.fn().mockRejectedValue(new Error('denied'))).store.get('photos/a/480.webp'),
    ).rejects.toThrow('denied');
  });

  it('deletes in batches S3 accepts', async () => {
    const { send, store } = setup(vi.fn().mockResolvedValue({}));
    await store.delete(Array.from({ length: 1001 }, (_, i) => `photos/a/${i}`));
    expect(send).toHaveBeenCalledTimes(2);
    const first = send.mock.calls[0]?.[0] as DeleteObjectsCommand;
    expect(first.input.Delete?.Objects).toHaveLength(1000);
  });

  it('fails when S3 reports files it kept, so private documents can’t linger unnoticed', async () => {
    const { store } = setup(vi.fn().mockResolvedValue({ Errors: [{ Key: 'proofs/a/b' }] }));
    await expect(store.delete(['proofs/a/b'])).rejects.toThrow('S3 kept 1');
  });

  it('refuses bad keys before calling out', async () => {
    const { send, store } = setup();
    await expect(store.put('../x', Buffer.from('x'), 'text/plain')).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
