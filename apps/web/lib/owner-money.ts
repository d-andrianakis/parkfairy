const MONEY = /^\d{1,6}(?:[.,]\d{1,2})?$/;

/**
 * What an owner typed, as integer minor units: `3,50` and `3.50` are both 350. Built from the
 * digits, never through a float, so no amount drifts by a cent. Null when it isn't an amount.
 */
export function parseMoney(text: string): number | null {
  const value = text.trim();
  if (!MONEY.test(value)) return null;
  const [euros = '0', cents = ''] = value.split(/[.,]/);
  return Number(euros) * 100 + Number(cents.padEnd(2, '0'));
}

/** Minor units as an owner would type them, with the decimal mark of their language. */
export function moneyText(minor: number | null, locale: string): string {
  if (minor === null) return '';
  const euros = Math.floor(minor / 100);
  const cents = String(minor % 100).padStart(2, '0');
  return `${euros}${locale === 'el' ? ',' : '.'}${cents}`;
}
