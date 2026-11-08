const KEY = 'parkfairy.typed-plate';

/**
 * Carries a number plate typed on one hold to the next, in this tab only: a space taken meanwhile
 * sends the driver to choose another, and they shouldn't type the car again (WCAG 3.3.7). Kept
 * until the booking stands, then forgotten. Storage can be blocked; losing this only means typing
 * the plate again.
 */
export function rememberPlate(plate: string): void {
  try {
    sessionStorage.setItem(KEY, plate);
  } catch {}
}

export function recallPlate(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function forgetPlate(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
