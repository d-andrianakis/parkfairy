import { PHOTO_LIMITS, PHOTO_WIDTHS } from '@parkfairy/contracts';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { ObjectStore } from './object-store.js';
import {
  cleanScan,
  MAX_INPUT_PIXELS,
  PhotoRejected,
  photoObjectKey,
  photoObjectKeys,
  storePhoto,
} from './photo-pipeline.js';

function memoryStore() {
  const files = new Map<string, Buffer>();
  const store: ObjectStore = {
    put: (key, body) => {
      files.set(key, body);
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(files.get(key) ?? null),
    delete: (keys) => {
      keys.forEach((key) => files.delete(key));
      return Promise.resolve();
    },
  };
  return { store, files };
}

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });

const rejection = async (input: Buffer) => {
  try {
    await storePhoto(input, memoryStore().store);
  } catch (error) {
    return error instanceof PhotoRejected ? error.code : error;
  }
  return 'accepted';
};

describe('storePhoto', () => {
  it('stores a WebP at each width and reports the largest size', async () => {
    const { store, files } = memoryStore();
    const photo = await storePhoto(await solid(2000, 1000).jpeg().toBuffer(), store);

    expect(photo.key).toMatch(/^[0-9a-f]{32}$/);
    expect([photo.width, photo.height]).toEqual([1600, 800]);
    expect([...files.keys()].sort()).toEqual(photoObjectKeys(photo.key).sort());
    for (const width of PHOTO_WIDTHS) {
      const stored = files.get(photoObjectKey(photo.key, width));
      const metadata = await sharp(stored).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(width);
    }
  });

  it('reports a dominant colour close to the picture', async () => {
    const { color } = await storePhoto(
      await solid(1200, 800).png().toBuffer(),
      memoryStore().store,
    );
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(Number.parseInt(color.slice(1, 3), 16)).toBeGreaterThan(150);
    expect(Number.parseInt(color.slice(5, 7), 16)).toBeLessThan(100);
  });

  it('gives the same picture the same key', async () => {
    const input = await solid(1200, 800).png().toBuffer();
    const first = await storePhoto(input, memoryStore().store);
    const second = await storePhoto(input, memoryStore().store);
    expect(first.key).toBe(second.key);
  });

  it('never upscales a photo narrower than the largest width', async () => {
    const photo = await storePhoto(await solid(1200, 800).png().toBuffer(), memoryStore().store);
    expect(photo.width).toBe(1200);
  });

  it('strips location and camera details', async () => {
    const { store, files } = memoryStore();
    const input = await solid(1200, 800)
      .withExif({ IFD0: { Copyright: 'someone', Make: 'Camera' }, IFD3: { GPSLatitude: '37/1' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const photo = await storePhoto(input, store);
    for (const key of photoObjectKeys(photo.key)) {
      expect((await sharp(files.get(key)).metadata()).exif).toBeUndefined();
    }
  });

  it('applies the camera’s rotation, so a portrait photo stays portrait', async () => {
    const input = await solid(1000, 1600).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const photo = await storePhoto(input, memoryStore().store);
    expect(photo.width).toBeGreaterThan(photo.height); // rotated 90°: 1600 × 1000
  });

  it('refuses photos too small to look right', async () => {
    expect(
      await rejection(
        await solid(PHOTO_LIMITS.minWidth - 1, 800)
          .png()
          .toBuffer(),
      ),
    ).toBe('PHOTO_TOO_SMALL');
  });

  it('measures width as shown, after the camera’s rotation', async () => {
    const narrowAsShown = await solid(1600, 800).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect(await rejection(narrowAsShown)).toBe('PHOTO_TOO_SMALL');
  });

  it('refuses a decompression bomb before decoding it', async () => {
    const side = Math.ceil(Math.sqrt(MAX_INPUT_PIXELS)) + 1;
    const bomb = await sharp({
      create: { width: side, height: side, channels: 3, background: '#000' },
      limitInputPixels: false,
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(PHOTO_LIMITS.maxBytes);
    expect(await rejection(bomb)).toBe('PHOTO_UNREADABLE');
    await expect(cleanScan(bomb, 'image/png')).rejects.toThrow();
  });

  it('refuses anything that is not a real image, whatever it claims', async () => {
    expect(await rejection(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(
      'PHOTO_UNREADABLE',
    );
    expect(await rejection(Buffer.from('%PDF-1.7 not a photo'))).toBe('PHOTO_UNREADABLE');
    expect(await rejection(Buffer.alloc(0))).toBe('PHOTO_UNREADABLE');
  });

  it('refuses a format outside the list, even a real image', async () => {
    expect(await rejection(await solid(1200, 800).gif().toBuffer())).toBe('PHOTO_UNREADABLE');
  });

  it('refuses a truncated file', async () => {
    const whole = await solid(1200, 800).jpeg().toBuffer();
    expect(await rejection(whole.subarray(0, whole.length / 2))).toBe('PHOTO_UNREADABLE');
  });

  it('takes a scan’s metadata out, and refuses what isn’t one', async () => {
    const scan = await solid(1000, 1400)
      .withExif({ IFD0: { Make: 'Camera' }, IFD3: { GPSLatitude: '37/1' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(await cleanScan(scan, 'image/jpeg')).metadata()).exif).toBeUndefined();
    await expect(cleanScan(Buffer.from('nope'), 'image/png')).rejects.toThrow();
  });

  it('stores nothing when it refuses', async () => {
    const { store, files } = memoryStore();
    await storePhoto(Buffer.from('nope'), store).catch(() => undefined);
    expect(files.size).toBe(0);
  });
});
