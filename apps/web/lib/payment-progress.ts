/**
 * Whether a payment is under way on this page: the card sent, a bank's check open. The hold timer
 * waits for it rather than end the page in the middle of it (WCAG 2.2.1); what the payment comes
 * to decides what the page says next.
 */
let paying = false;

export function setPaying(value: boolean): void {
  paying = value;
}

export function isPaying(): boolean {
  return paying;
}
