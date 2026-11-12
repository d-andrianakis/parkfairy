'use client';

import { openPayoutDashboard, startPayoutOnboarding } from '@parkfairy/api-client';
import { Button } from '@parkfairy/ui/components/button';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormError } from '@/components/form-error';
import { loadPage } from '@/lib/load-page';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';

/** Where Stripe's onboarding and Express dashboard live. */
const STRIPE_CONNECT = 'https://connect.stripe.com';

/**
 * Off to Stripe (decision #48): its onboarding, to set payouts up or carry on, or the owner's
 * Express dashboard once set up. The link is asked for at the press, as each is one use and short
 * lived, and opened in this tab: Stripe brings the owner back to the payouts page.
 */
export function PayoutButton({ kind }: { kind: 'start' | 'continue' | 'dashboard' }) {
  const t = useTranslations('Owner.payouts');
  const locale = useLocale() as 'el' | 'en';
  const ownerError = useOwnerError();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await attempt(() =>
      kind === 'dashboard' ? openPayoutDashboard() : startPayoutOnboarding({ body: { locale } }),
    );
    // Only ever to Stripe's own pages: a link from anywhere else is not followed.
    if (outcome.ok && outcome.data && new URL(outcome.data.url).origin === STRIPE_CONNECT) {
      loadPage(outcome.data.url);
      return;
    }
    setBusy(false);
    setFailure(outcome.ok ? ownerError({}) : ownerError(outcome.failure));
  }

  return (
    <div className="grid gap-3">
      <FormError message={failure} />
      <div>
        <Button
          type="button"
          className={WRAPPING_BUTTON}
          variant={kind === 'dashboard' ? 'outline' : 'default'}
          aria-disabled={busy || undefined}
          onClick={() => void open()}
        >
          <span>{busy ? t('opening') : t(kind)}</span>
        </Button>
      </div>
    </div>
  );
}
