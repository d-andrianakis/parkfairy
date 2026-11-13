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

export interface Payee {
  ownerId: string;
  /** Basis points of the owners' share; a listing's payees add up to 10000. */
  shareBps: number;
  primary: boolean;
}

/**
 * The owners' share of a booking split between its payees by their shares (co-ownership, #54), in
 * whole minor units adding up to it exactly: each gets the whole cents of their share, and the
 * cents left over go one each to the largest remainders, the primary owner first on a tie, then by
 * owner id, so the split is the same every time it's worked out.
 */
export function splitShares(ownerMinor: number, payees: readonly Payee[]): Map<string, number> {
  if (!Number.isSafeInteger(ownerMinor) || ownerMinor < 0) {
    throw new RangeError('Shares are counted in whole minor units');
  }
  const totalBps = payees.reduce((sum, payee) => sum + payee.shareBps, 0);
  if (payees.length === 0 || totalBps <= 0 || payees.some((payee) => payee.shareBps < 0)) {
    throw new RangeError('A split needs payees with shares');
  }
  const parts = payees.map((payee) => {
    const exact = ownerMinor * payee.shareBps;
    return {
      payee,
      whole: Math.floor(exact / totalBps),
      remainder: exact % totalBps,
    };
  });
  let left = ownerMinor - parts.reduce((sum, part) => sum + part.whole, 0);
  const order = [...parts].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      Number(b.payee.primary) - Number(a.payee.primary) ||
      a.payee.ownerId.localeCompare(b.payee.ownerId),
  );
  for (const part of order) {
    if (left === 0) break;
    part.whole += 1;
    left -= 1;
  }
  return new Map(parts.map((part) => [part.payee.ownerId, part.whole]));
}
