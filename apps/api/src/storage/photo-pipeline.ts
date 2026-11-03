import { createHash } from 'node:crypto';
import { PHOTO_LIMITS, PHOTO_WIDTHS } from '@parkfairy/contracts';
import sharp from 'sharp';
import type { ObjectStore } from './object-store.js';

/**
 * Enough for any phone, and the line against decompression bombs: a 1.4 MB file can decode to
 * gigabytes, so this applies to everything sharp opens, proofs included.
 */
export const MAX_INPUT_PIXELS = 64_000_000;
const WEBP_QUALITY = 78;
const DECODE = { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS } as const;

const SIGNATURES: readonly (readonly number[])[] = [
  [0xff, 0xd8, 0xff], // JPEG
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
];

/** Only what we accept reaches libvips, which otherwise parses every format it knows. */
function looksLikePhoto(input: Buffer): boolean {
  const webp =
    input.subarray(0, 4).toString('latin1') === 'RIFF' &&
    input.subarray(8, 12).toString('latin1') === 'WEBP';
  return (
    webp || SIGNATURES.some((magic) => input.subarray(0, magic.length).equals(Buffer.from(magic)))
  );
}

export class PhotoRejected extends Error {
  constructor(readonly code: 'PHOTO_UNREADABLE' | 'PHOTO_TOO_SMALL') {
    super(code);
  }
}

export interface StoredPhoto {
  key: string;
  width: number;
  height: number;
  color: string;
}

export function photoObjectKey(key: string, width: number): string {
  return `photos/${key}/${width}.webp`;
}

const hex = (value: number) => value.toString(16).padStart(2, '0');

/**
 * Every stored photo is re-encoded here, so what we serve is pixels we produced, whatever was
 * uploaded: the bytes decide the format, never the header or the file name, and the location,
 * camera and date in the original's metadata stop here (sharp drops them unless told not to).
 *
 * The original is decoded once, to the largest width, and the rest are made from that in turn:
 * decoding it for every width took ten times as long on a big PNG. The intermediate is raw, so no
 * size inherits the compression of another.
 */
export async function storePhoto(input: Buffer, store: ObjectStore): Promise<StoredPhoto> {
  if (!looksLikePhoto(input)) throw new PhotoRejected('PHOTO_UNREADABLE');
  const key = createHash('sha256').update(input).digest('hex').slice(0, 32);

  const variants: { width: number; data: Buffer; size: { width: number; height: number } }[] = [];
  let color: string;
  try {
    // Inside the try: sharp refuses an empty buffer as soon as it is built.
    const image = sharp(input, DECODE).autoOrient();
    const metadata = await image.metadata();
    if (metadata.autoOrient.width < PHOTO_LIMITS.minWidth) {
      throw new PhotoRejected('PHOTO_TOO_SMALL');
    }
    const largest = Math.max(...PHOTO_WIDTHS);
    const { data: pixels, info } = await image
      .resize({ width: largest, withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const decoded = () =>
      sharp(pixels, { raw: { width: info.width, height: info.height, channels: info.channels } });

    for (const width of PHOTO_WIDTHS) {
      const { data, info: size } = await decoded()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
      variants.push({ width, data, size: { width: size.width, height: size.height } });
    }
    const { dominant } = await decoded().stats();
    color = `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
  } catch (error) {
    if (error instanceof PhotoRejected) throw error;
    throw new PhotoRejected('PHOTO_UNREADABLE');
  }

  await Promise.all(
    variants.map(({ width, data }) => store.put(photoObjectKey(key, width), data, 'image/webp')),
  );
  const largest = variants.at(-1);
  if (!largest) throw new Error('PHOTO_WIDTHS is empty');
  return { key, width: largest.size.width, height: largest.size.height, color };
}

export function photoObjectKeys(key: string): string[] {
  return PHOTO_WIDTHS.map((width) => photoObjectKey(key, width));
}

/** A scan with a phone's location and camera details taken out. Throws on anything unreadable. */
export function cleanScan(file: Buffer, contentType: 'image/jpeg' | 'image/png'): Promise<Buffer> {
  const image = sharp(file, DECODE).autoOrient();
  return (contentType === 'image/png' ? image.png() : image.jpeg()).toBuffer();
}
