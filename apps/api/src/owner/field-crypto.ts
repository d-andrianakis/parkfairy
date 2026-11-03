import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
/** Set on both sides: Node would otherwise accept a tag cut down to 4 bytes. */
const TAG_BYTES = 16;
const VERSION = 'v1';

export interface FieldCrypto {
  /** `context` binds the value to its owner and field, so a copied cell won't decrypt elsewhere. */
  encrypt(value: string, context: string): string;
  decrypt(stored: string, context: string): string;
}

/** The key as `loadEnv` left it: 32 bytes, or derived from the session secret on this machine. */
export function fieldKey(base64Key: string | undefined, fallbackSecret: string): Buffer {
  return base64Key
    ? Buffer.from(base64Key, 'base64')
    : createHash('sha256').update(`owner-data:${fallbackSecret}`).digest();
}

/**
 * Tax numbers and birth dates, encrypted before they reach the database, so a leaked dump or
 * backup doesn't hold them in the clear. The version lets a later key or scheme sit beside this
 * one during a rotation.
 */
export function createFieldCrypto(key: Buffer): FieldCrypto {
  if (key.length !== 32) throw new Error('The owner data key must be 32 bytes');
  return {
    encrypt(value, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [VERSION, iv, cipher.getAuthTag(), data]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.');
    },
    decrypt(stored, context) {
      const [version, iv, tag, data] = stored.split('.');
      if (version !== VERSION || !iv || !tag || data === undefined) {
        throw new Error('Unreadable encrypted value');
      }
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
