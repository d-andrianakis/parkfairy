import { Alert, AlertDescription } from '@parkfairy/ui/components/alert';
import { Button } from '@parkfairy/ui/components/button';
import { CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountChecklist } from '@/components/owner/account-checklist';
import { ManagedListings } from '@/components/owner/managed-listings';
import { ContinueCard } from '@/components/owner/continue-card';
import { NewListingButton } from '@/components/owner/listing-actions';
import { ListingMilestones } from '@/components/owner/listing-milestones';
import { OwnerLanding, SignedOutActions } from '@/components/owner/owner-landing';
import { PayoutsCard } from '@/components/owner/payouts-card';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { nextOwnerAction, setupProgress } from '@/lib/owner';
import { loadManagedListings, loadOwnerOnboarding, loadOwnerPayouts } from '@/lib/owner.server';
import { getSession } from '@/lib/session';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Owner' });
  return { title: t('metaTitle') };
}

/**
 * One address for the whole journey: what it takes for someone new, and for an owner the place
 * to pick up from, wherever they stopped. The API reports what is saved; nothing here remembers.
 */
export default async function OwnerPage({ params }: LocaleParams) {
  const locale = await localeFromParams(params);
  const session = await getSession();
  const t = await getTranslations({ locale, namespace: 'Owner' });

  if (!session) return <OwnerLanding action={<SignedOutActions />} />;

  // Together: the payouts card is no second wait.
  const [onboarding, payouts, managed] = await Promise.all([
    loadOwnerOnboarding(),
    loadOwnerPayouts(),
    loadManagedListings(),
  ]);
  const payoutStatus = payouts?.available ? payouts.status : null;
  if (!onboarding) {
    return (
      <div className="mx-auto grid max-w-xl gap-4 px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('errors.generic')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!onboarding.started) {
    // A manager has no listing of their own: what they run comes first, then the way to list one.
    return (
      <OwnerLanding
        before={managed.length > 0 ? <ManagedListings listings={managed} /> : null}
        action={
          <div>
            <Button asChild>
              <Link href="/owner/profile">{t('landing.start')}</Link>
            </Button>
          </div>
        }
      />
    );
  }

  const action = nextOwnerAction(onboarding);
  const focus = action.kind === 'listing' ? action.listing : onboarding.listings[0];

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-10">
      <div className="grid gap-2">
        {/* Focusable, for after a draft is deleted and the focus has nowhere else to go. */}
        <h1
          id="owner-heading"
          tabIndex={-1}
          className="text-3xl font-semibold tracking-tight outline-none"
        >
          {t('dashboard.title')}
        </h1>
        <p className="text-muted-foreground">{t('dashboard.lead')}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link
            href="/owner/calendar"
            className="text-primary underline underline-offset-4 hover:decoration-2"
          >
            {t('calendar.link')}
          </Link>
          <Link
            href="/owner/earnings"
            className="text-primary underline underline-offset-4 hover:decoration-2"
          >
            {t('earnings.link')}
          </Link>
        </p>
      </div>
      <ContinueCard action={action} progress={setupProgress(onboarding.doneAccountSteps, focus)} />
      <AccountChecklist done={onboarding.doneAccountSteps} />
      <ManagedListings listings={managed} />
      <PayoutsCard locale={locale} payouts={payouts} />
      {onboarding.listings.map((listing) => (
        <ListingMilestones key={listing.id} listing={listing} payouts={payoutStatus} />
      ))}
      {onboarding.listings.length > 0 ? (
        <NewListingButton label={t('dashboard.addAnother')} />
      ) : null}
    </div>
  );
}
