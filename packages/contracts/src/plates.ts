/**
 * Number plates, without zod: the booking page checks one as it is typed and ships no schema for it.
 */

/**
 * Greek plates use only the capitals that look like Latin ones, and people type either. Read as
 * Latin, so ΙΚΒ-1234 and IKB 1234 are the same car to the owner checking it.
 */
const GREEK_PLATE_LETTERS: Record<string, string> = {
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
};

export const VEHICLE_PLATE_LIMITS = {
  /** What may be typed, separators included. */
  input: 20,
  /** Letters and digits once the separators are gone. */
  min: 2,
  max: 10,
} as const;

/** Capitals, Greek look-alikes as Latin, no accents, spaces, dots or hyphens: `IKB1234`. */
export function normalizeVehiclePlate(raw: string): string {
  return [...raw.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()]
    .map((char) => GREEK_PLATE_LETTERS[char] ?? char)
    .join('')
    .replace(/[\s.\-·]/gu, '');
}

const PLATE = new RegExp(`^[A-Z0-9]{${VEHICLE_PLATE_LIMITS.min},${VEHICLE_PLATE_LIMITS.max}}$`);

export function isVehiclePlate(raw: string): boolean {
  return raw.length <= VEHICLE_PLATE_LIMITS.input && PLATE.test(normalizeVehiclePlate(raw));
}
