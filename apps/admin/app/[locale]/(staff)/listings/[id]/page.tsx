import type { AdminListingReview } from '@parkfairy/api-client';
import { Alert, AlertDescription, AlertTitle } from '@parkfairy/ui/components/alert';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';

import { ClientMessages } from '@/components/client-messages';
import { MarkedText } from '@/components/marked-text';
import { MissingNotice } from '@/components/missing-notice';
import { None } from '@/components/none';
import { StandingNotice } from '@/components/standing-notice';
import { StatusBadge } from '@/components/status-badge';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { Link } from '@/i18n/navigation';
import { localeFromParams, type LocaleParams } from '@/i18n/params';
import { loadReview } from '@/lib/admin.server';
import { withClock } from '@/lib/clock';
import { requireSession } from '@/lib/session';
import { accountPageUrl } from '@/lib/site';

import { DecisionPanel } from './decision-panel';
import { ModerationPanel } from './moderation-panel';

type Props = LocaleParams & { params: Promise<{ locale: string; id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: await localeFromParams(params), namespace: 'Admin' });
  return { title: t('review.metaTitle') };
}

export default async function ReviewPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const locale = await localeFromParams(params);
  const { standing } = await requireSession(`/listings/${id}`);
  if (standing !== 'staff')
    return <StandingNotice standing={standing} accountUrl={accountPageUrl(locale)} />;

  const t = await getTranslations({ locale, namespace: 'Admin' });
  const review = await loadReview(id);
  if (review === 'not-found') notFound();
  if (typeof review === 'string') {
    return (
      <>
        <BackLink />
        <MissingNotice reason={review} />
      </>
    );
  }
  const format = await getFormatter({ locale });
  const when = (iso: string) => (
    <time dateTime={iso}>
      {format.dateTime(
        new Date(iso),
        withClock(locale, { dateStyle: 'medium', timeStyle: 'short' }),
      )}
    </time>
  );

  return (
    <>
      <BackLink />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 lang={review.contentLocale} className="text-2xl font-semibold tracking-tight">
          {review.name ?? t('queue.unnamed')}
        </h1>
        <StatusBadge status={review.status} />
      </div>

      {review.reviewNote ? (
        <Alert role="note" className="mb-6">
          <AlertTitle className="line-clamp-none">{t('review.lastNote')}</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-line">
              <MarkedText text={review.reviewNote} lang={locale} />
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="listing-heading" className="mb-8">
        <h2 id="listing-heading" className="mb-3 text-lg font-semibold">
          {t('review.listing')}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
          <Row label={t('review.address')} lang={review.address ? review.contentLocale : undefined}>
            {review.address ?? <None />}
          </Row>
          <Row label={t('review.area')}>
            {review.areaId ? t(`areas.${review.areaId}`) : <None />}
          </Row>
          <Row label={t('review.rate')}>
            {review.hourlyRate ? (
              t('review.perHour', {
                amount: format.number(review.hourlyRate.amountMinor / 100, {
                  style: 'currency',
                  currency: review.hourlyRate.currency,
                }),
              })
            ) : (
              <None />
            )}
          </Row>
          <Row label={t('review.spaces')}>
            {review.spaces.length ? (
              <>
                {t('review.spaceCount', { count: review.spaces.length })}:{' '}
                <span lang={review.contentLocale}>{format.list(review.spaces)}</span>
              </>
            ) : (
              <None />
            )}
          </Row>
          <Row label={t('review.photos')}>{format.number(review.photos)}</Row>
          <Row label={t('review.landRegistration')}>
            {review.landRegistrationNumber ?? <None />}
          </Row>
          <Row label={t('review.sentIn')}>
            {review.submittedAt ? when(review.submittedAt) : <None />}
          </Row>
          <Row
            label={t('review.description')}
            lang={review.description ? review.contentLocale : undefined}
          >
            <span className="whitespace-pre-line">{review.description ?? <None />}</span>
          </Row>
        </dl>
      </section>

      <section aria-labelledby="owners-heading" className="mb-8">
        <h2 id="owners-heading" className="mb-3 text-lg font-semibold">
          {t('review.owners')}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">{t('review.ownersLead')}</p>
        <OwnersList owners={review.owners} />
      </section>

      <section aria-labelledby="proofs-heading" className="mb-8">
        <h2 id="proofs-heading" className="mb-3 text-lg font-semibold">
          {t('review.proofs')}
        </h2>
        {review.proofs.length === 0 ? (
          <p className="text-muted-foreground">{t('review.noProofs')}</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">{t('review.proofsLead')}</p>
            <ul className="grid gap-2">
              {review.proofs.map((proof) => (
                <li key={proof.id} className="min-w-0 break-words">
                  {/* A download from this origin; the API logs that it was opened. */}
                  <a
                    href={`/api/v1/admin/listings/${review.id}/proofs/${proof.id}`}
                    download
                    className="text-primary underline underline-offset-4 hover:decoration-2"
                  >
                    {t('review.proofLink', {
                      kind: t(`proofKinds.${proof.kind}`),
                      name: proof.fileName,
                    })}
                  </a>{' '}
                  <span className="text-sm text-muted-foreground">
                    {t('review.proofMeta', {
                      size: format.number(Math.max(1, Math.round(proof.sizeBytes / 1024)), {
                        style: 'unit',
                        unit: 'kilobyte',
                      }),
                    })}
                    {' · '}
                    {when(proof.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="decision-heading">
        <h2 id="decision-heading" className="mb-3 text-lg font-semibold">
          {t('review.decision')}
        </h2>
        <ClientMessages namespaces={CLIENT_NAMESPACES.review}>
          <DecisionPanel
            id={review.id}
            canDecide={review.canDecide}
            own={review.own}
            status={review.status}
          />
        </ClientMessages>
      </section>

      {/* A live listing can be taken down and a suspended one brought back (#78, #81). */}
      {review.status === 'published' || review.status === 'suspended' ? (
        <section aria-labelledby="moderation-heading" className="mt-8">
          <h2 id="moderation-heading" className="mb-3 text-lg font-semibold">
            {t('review.moderation')}
          </h2>
          <ClientMessages namespaces={CLIENT_NAMESPACES.moderation}>
            <ModerationPanel
              id={review.id}
              own={review.own}
              canSuspend={review.canSuspend}
              canReinstate={review.canReinstate}
              upcomingBookings={review.upcomingBookings}
            />
          </ClientMessages>
        </section>
      ) : null}
    </>
  );
}

function BackLink() {
  const t = useTranslations('Admin.review');
  return (
    <p className="mb-4 text-sm">
      <Link
        href="/listings"
        className="text-primary underline underline-offset-4 hover:decoration-2"
      >
        {t('back')}
      </Link>
    </p>
  );
}

function Row({
  label,
  lang,
  children,
}: {
  label: string;
  lang?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd lang={lang} className="min-w-0 break-words">
        {children}
      </dd>
    </>
  );
}

/**
 * Each owner as a block of their own rather than a row of eight columns: it reads the same on a
 * phone (WCAG 1.4.10), and a table that scrolls sideways with nothing in it to focus is out of
 * reach of the keyboard.
 */
function OwnersList({ owners }: { owners: AdminListingReview['owners'] }) {
  const t = useTranslations('Admin.review');
  return (
    <ul aria-label={t('ownersCaption')} className="grid gap-4 md:grid-cols-2">
      {owners.map((owner, index) => {
        const person = [owner.firstName, owner.lastName].filter(Boolean).join(' ');
        return (
          <li key={`${owner.accountName}-${index}`} className="rounded-lg border p-4">
            <h3 className="font-semibold break-words">
              {owner.accountName}
              {owner.legalName || person ? (
                <span className="block text-sm font-normal text-muted-foreground">
                  {owner.legalName ?? person}
                </span>
              ) : null}
            </h3>
            <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
              <Row label={t('ownerRole')}>{t(`roles.${owner.role}`)}</Row>
              <Row label={t('ownerKind')}>{owner.kind ? t(`kinds.${owner.kind}`) : <None />}</Row>
              <Row label={t('ownerCountry')}>
                {owner.country ?? <None />} / {owner.taxCountry}
              </Row>
              <Row label={t('ownerTax')}>
                <TaxEnding label={t('taxId')} value={owner.taxIdEnding} />
                <TaxEnding label={t('vatId')} value={owner.vatIdEnding} />
                <TaxEnding label={t('registration')} value={owner.registrationEnding} />
                {owner.taxIdEnding || owner.vatIdEnding || owner.registrationEnding ? null : (
                  <None />
                )}
              </Row>
              <Row label={t('ownerShare')}>{t('percent', { percent: owner.sharePercent })}</Row>
              <Row label={t('ownerVerification')}>{t(`verification.${owner.verification}`)}</Row>
              <Row label={t('ownerDetails')}>
                {owner.detailsComplete ? t('complete') : t('incomplete')}
              </Row>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

function TaxEnding({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations('Admin.review');
  if (!value) return null;
  return <span className="block">{t('taxEnding', { label, ending: value })}</span>;
}
