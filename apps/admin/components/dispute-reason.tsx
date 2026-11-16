import { useTranslations } from 'next-intl';

/**
 * Stripe's own word for why the bank disputed, in ours where it is a known one; any other is shown
 * as it came, in English and marked so (a Greek voice would spell it out letter by letter).
 */
export function DisputeReason({ reason }: { reason: string }) {
  const t = useTranslations('Admin.booking');
  const loose = t as unknown as ((key: string) => string) & { has(key: string): boolean };
  const key = `disputeReasons.${reason}`;
  return loose.has(key) ? <>{loose(key)}</> : <span lang="en">{reason.replaceAll('_', ' ')}</span>;
}
