'use client';

import { copyListingHoursExceptions, type OwnerHoursExceptionsCopy } from '@parkfairy/api-client';
import type { Locale } from '@parkfairy/contracts/locales';
import { HOURS_EXCEPTIONS_MAX } from '@parkfairy/contracts/validation';
import { Button } from '@parkfairy/ui/components/button';
import { FieldLegend, FieldSet } from '@parkfairy/ui/components/field';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormError } from '@/components/form-error';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { CheckboxField } from './fields';
import { useFocusAfterRender } from './navigation';

export interface OtherListing {
  id: string;
  name: string | null;
  contentLocale: Locale;
}

type Problem = { kind: 'unsaved' } | { kind: 'none' } | { kind: 'refused'; text: string };

/** What a listing that kept its own dates is told, by why it kept them. */
const KEPT_MESSAGE = { clash: 'copyClash', full: 'copyFull' } as const;

/**
 * Adds a listing's saved closures and special hours to the owner's other listings, any or all of
 * them (decision #29). It copies what is saved, so unsaved changes have to be saved first. The
 * outcome stays on the page in a status region: which listings got the dates, and which kept
 * their own because the days clashed or there was no room.
 */
export function CopyHoursExceptions({
  id,
  listings,
  unsaved,
}: {
  id: string;
  listings: OtherListing[];
  unsaved: boolean;
}) {
  const t = useTranslations('Owner.closures');
  const tDashboard = useTranslations('Owner.dashboard');
  const ownerError = useOwnerError();
  const focusAfter = useFocusAfterRender();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<Problem | null>(null);
  const [report, setReport] = useState<OwnerHoursExceptionsCopy['results'] | null>(null);
  const [busy, setBusy] = useState(false);
  const everyone = chosen.size === listings.length;
  const firstChoice = listings.length > 1 ? 'copy-all' : `copy-${listings[0]?.id ?? ''}`;

  function choose(listingId: string, on: boolean) {
    setProblem(null);
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(listingId);
      else next.delete(listingId);
      return next;
    });
  }

  /** Cleared first, so the same problem twice is said twice. */
  function refuse(next: Problem) {
    setProblem(null);
    requestAnimationFrame(() => setProblem(next));
  }

  async function copy(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setReport(null);
    if (unsaved) {
      refuse({ kind: 'unsaved' });
      return;
    }
    if (chosen.size === 0) {
      refuse({ kind: 'none' });
      focusAfter(firstChoice);
      return;
    }
    setProblem(null);
    setBusy(true);
    const outcome = await attempt(() =>
      copyListingHoursExceptions({ path: { id }, body: { to: [...chosen] } }),
    );
    setBusy(false);
    if (!outcome.ok) {
      refuse({ kind: 'refused', text: ownerError(outcome.failure) });
      return;
    }
    setReport(outcome.data?.results ?? []);
  }

  const listingOf = (listingId: string) => listings.find((other) => other.id === listingId);
  const nameOf = (listingId: string) => listingOf(listingId)?.name ?? tDashboard('untitled');
  /** The owner's own name for a listing is read in the language they wrote it in. */
  const langOf = (listingId: string) => {
    const listing = listingOf(listingId);
    return listing?.name ? listing.contentLocale : undefined;
  };

  const copied = report?.filter((result) => result.outcome === 'copied').length ?? 0;
  const kept = report?.filter((result) => result.outcome !== 'copied') ?? [];

  return (
    <section aria-labelledby="copy-heading" className="grid gap-4 rounded-lg border p-4">
      <h2 id="copy-heading" className="text-lg font-semibold">
        {t('copyHeading')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('copyLead')}</p>
      <form onSubmit={(event) => void copy(event)} noValidate className="grid gap-4">
        <FieldSet>
          <FieldLegend variant="label">{t('copyLegend')}</FieldLegend>
          {listings.length > 1 ? (
            <CheckboxField
              id="copy-all"
              label={t('copyAll')}
              checked={everyone}
              error={problem?.kind === 'none' ? t('copyNone') : undefined}
              onChange={(on) => {
                setProblem(null);
                setChosen(new Set(on ? listings.map((listing) => listing.id) : []));
              }}
            />
          ) : null}
          <ul className="grid gap-2">
            {listings.map((listing) => (
              <li key={listing.id}>
                <CheckboxField
                  id={`copy-${listing.id}`}
                  label={
                    <span lang={listing.name ? listing.contentLocale : undefined}>
                      {nameOf(listing.id)}
                    </span>
                  }
                  checked={chosen.has(listing.id)}
                  error={
                    problem?.kind === 'none' && listings.length === 1 ? t('copyNone') : undefined
                  }
                  onChange={(on) => choose(listing.id, on)}
                />
              </li>
            ))}
          </ul>
        </FieldSet>
        <FormError
          message={
            // Asking for a save is out of date once the changes are saved.
            problem?.kind === 'unsaved' && unsaved
              ? t('copyUnsaved')
              : problem?.kind === 'refused'
                ? problem.text
                : null
          }
        />
        {/* Always there, so what it says next is read out. */}
        <div role="status" className="grid gap-1 text-sm">
          {report && copied > 0 ? <p>{t('copyDone', { count: copied })}</p> : null}
          {kept.map(({ id: listingId, outcome }) => (
            <p key={listingId}>
              {t.rich(KEPT_MESSAGE[outcome === 'clash' ? 'clash' : 'full'], {
                name: nameOf(listingId),
                max: HOURS_EXCEPTIONS_MAX,
                listing: (chunks) => <span lang={langOf(listingId)}>{chunks}</span>,
              })}
            </p>
          ))}
        </div>
        <div>
          <Button
            type="submit"
            variant="outline"
            className={WRAPPING_BUTTON}
            aria-disabled={busy || undefined}
          >
            {busy ? t('copying') : t('copyButton')}
          </Button>
        </div>
      </form>
    </section>
  );
}
