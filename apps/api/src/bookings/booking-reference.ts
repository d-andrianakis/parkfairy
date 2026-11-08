import { randomBytes } from 'node:crypto';

/** Crockford base32: digits and capitals less I, L, O and U, which people misread or mishear. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A booking's reference, `K7M4-Q2ZD`: 40 random bits, read aloud at a gate or typed into a
 * search. It names a booking; it doesn't open one (every route checks whose it is). 32 divides
 * 256, so the low five bits of a random byte are uniform.
 */
export function newBookingReference(bytes: Buffer = randomBytes(8)): string {
  const chars = [...bytes.subarray(0, 8)].map((byte) => ALPHABET[byte & 31]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}
