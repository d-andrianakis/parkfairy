/**
 * Who gets what of a booking's money (decisions #15, #50, #51), in minor units: what's kept is
 * what the driver paid less what went back; Parkfairy's commission is its share of what's kept
 * (half up, to the cent); the owner gets the rest of it, exactly. Stripe's fee comes out of
 * Parkfairy's commission, never the owner's share.
 */
export interface Shares {
  keptMinor: number;
  commissionMinor: number;
  ownerMinor: number;
}

export function sharesOf({
  totalMinor,
  refundMinor,
  commissionBps,
}: {
  totalMinor: number;
  refundMinor: number;
  /** Basis points: 1000 is 10%. */
  commissionBps: number;
}): Shares {
  if (![totalMinor, refundMinor, commissionBps].every(Number.isSafeInteger)) {
    throw new RangeError('Shares are counted in whole minor units');
  }
  if (refundMinor < 0 || refundMinor > totalMinor || commissionBps < 0 || commissionBps > 10_000) {
    throw new RangeError('A refund or a commission out of range');
  }
  const keptMinor = totalMinor - refundMinor;
  // Half up, in integers: (kept × bps + 5000) ÷ 10000, floored.
  const commissionMinor = Math.floor((keptMinor * commissionBps + 5_000) / 10_000);
  return { keptMinor, commissionMinor, ownerMinor: keptMinor - commissionMinor };
}
