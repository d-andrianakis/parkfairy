'use client';

import type { Locale } from '@parkfairy/contracts/locales';
import { Button } from '@parkfairy/ui/components/button';
import { FieldLegend, FieldSet } from '@parkfairy/ui/components/field';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { FormError } from '@/components/form-error';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { PlaceName, placeTag } from '@/components/parking/place-words';
import { Link } from '@/i18n/navigation';
import { useOwnerError, type Outcome } from '@/lib/owner-client';
import { ownerBookingsHref } from '@/lib/owner-href';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { CheckboxField } from './fields';
import { useFocusAfterRender } from './navigation';

export interface OtherListing {
  id: string;
  name: string | null;
  contentLocale: Locale;
}

/** What each listing named got: `copied`, or why it kept its own. */
export interface CopyResult {
  id: string;
  outcome: string;
}

export interface CopyTexts {
  heading: string;
  lead: string;
  legend: string;
  all: string;
  button: string;
  copying: string;
  none: string;
  done: (count: number) => string;
  /** Why a listing kept its own; `listing` wraps its name so it is read in its own language. */
  kept: (outcome: string, name: string, listing: (chunks: ReactNode) => ReactNode) => ReactNode;
  /** Without `prepare`: asks for a save first. */
  unsaved?: string;
  /** With `prepare`: the button while the page's changes save, */
  saving?: string;
  /** what is said here when they couldn't be saved (the page shows why), */
  notSaved?: string;
  /** what a copy after a save reports, so the owner knows both happened, */
  savedDone?: (count: number) => string;
  /** and a refused copy after a save: the save stands. */
  savedRefused?: (reason: string) => string;
}

type Problem = { kind: 'unsaved' } | { kind: 'none' } | { kind: 'refused'; text: string };

/**
 * Gives some or all of the owner's other listings what this page has saved (decisions #29, #30).
 * With `prepare`, unsaved changes are saved first; without it the owner is asked to. The outcome
 * stays on the page in a status region: which listings took it, and which kept their own and why.
 * `name` keeps the ids of two such sections apart.
 */
export function CopyToListings({
  name,
  listings,
  unsaved,
  texts,
  copy,
  prepare,
}: {
  name: string;
  listings: OtherListing[];
  unsaved: boolean;
  texts: CopyTexts;
  copy: (to: string[]) => Promise<Outcome<{ results: CopyResult[] } | undefined>>;
  /** Saves the page's changes; false when it couldn't, and the page has said why. */
  prepare?: () => Promise<boolean>;
}) {
  const tDashboard = useTranslations('Owner.dashboard');
  const tBookings = useTranslations('Owner.bookings');
  const ownerError = useOwnerError();
  const focusAfter = useFocusAfterRender();
  const invalid = useInvalidSubmitStatus();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<Problem | null>(null);
  const [report, setReport] = useState<{ results: CopyResult[]; saved: boolean } | null>(null);
  const [busy, setBusy] = useState<'saving' | 'copying' | null>(null);
  const everyone = chosen.size === listings.length;
  const firstChoice = listings.length > 1 ? `${name}-all` : `${name}-${listings[0]?.id ?? ''}`;

  function choose(listingId: string, on: boolean) {
    setProblem(null);
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(listingId);
      else next.delete(listingId);
      return next;
    });
  }

  /** Cleared first, so the same alert twice is announced twice. */
  function alert(next: Problem) {
    setProblem(null);
    requestAnimationFrame(() => setProblem(next));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setReport(null);
    if (chosen.size === 0) {
      // In place before the focus lands, so the choice is read with its error; the count is
      // said too, for when the focus was already there.
      setProblem({ kind: 'none' });
      invalid.report(1);
      focusAfter(firstChoice);
      return;
    }
    invalid.clear();
    if (unsaved && !prepare) {
      alert({ kind: 'unsaved' });
      return;
    }
    setProblem(null);
    const saving = unsaved && prepare !== undefined;
    if (saving) {
      setBusy('saving');
      if (!(await prepare())) {
        setBusy(null);
        alert({ kind: 'refused', text: texts.notSaved ?? '' });
        return;
      }
    }
    setBusy('copying');
    const outcome = await copy([...chosen]);
    setBusy(null);
    if (!outcome.ok) {
      const reason = ownerError(outcome.failure);
      alert({
        kind: 'refused',
        text: saving && texts.savedRefused ? texts.savedRefused(reason) : reason,
      });
      return;
    }
    setReport({ results: outcome.data?.results ?? [], saved: saving });
  }

  // Unnamed drafts are common here: numbered, so two of them can be told apart.
  const unnamed = listings.filter((listing) => !listing.name);
  const nameOf = (listingId: string) => {
    const listing = listings.find((other) => other.id === listingId);
    if (listing?.name) return listing.name;
    if (unnamed.length < 2) return tDashboard('untitled');
    return tDashboard('untitledNumber', {
      number: unnamed.findIndex((other) => other.id === listingId) + 1,
    });
  };
  /** The owner's own name for a listing is read in the language they wrote it in. */
  const langOf = (listingId: string) => {
    const listing = listings.find((other) => other.id === listingId);
    return listing?.name ? listing.contentLocale : undefined;
  };

  const results = report?.results ?? [];
  const copied = results.filter((result) => result.outcome === 'copied').length;
  const kept = results.filter((result) => result.outcome !== 'copied');
  const heading = `${name}-heading`;

  return (
    <section aria-labelledby={heading} className="grid gap-4 rounded-lg border p-4">
      <h2 id={heading} className="text-lg font-semibold">
        {texts.heading}
      </h2>
      <p className="text-sm text-muted-foreground">{texts.lead}</p>
      <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
        {invalid.region}
        <FieldSet>
          <FieldLegend variant="label">{texts.legend}</FieldLegend>
          {listings.length > 1 ? (
            <CheckboxField
              id={`${name}-all`}
              label={texts.all}
              checked={everyone}
              error={problem?.kind === 'none' ? texts.none : undefined}
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
                  id={`${name}-${listing.id}`}
                  label={
                    <span className="wrap-anywhere">
                      <PlaceName text={nameOf(listing.id)} lang={langOf(listing.id)} />
                    </span>
                  }
                  checked={chosen.has(listing.id)}
                  error={problem?.kind === 'none' && listings.length === 1 ? texts.none : undefined}
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
              ? (texts.unsaved ?? null)
              : problem?.kind === 'refused'
                ? problem.text
                : null
          }
        />
        {/* Always there, so what it says next is read out. */}
        <div role="status" className="grid gap-1 text-sm wrap-anywhere">
          {report && copied > 0 ? (
            <p>{report.saved && texts.savedDone ? texts.savedDone(copied) : texts.done(copied)}</p>
          ) : null}
          {kept.map(({ id: listingId, outcome }) => (
            <p key={listingId}>
              {texts.kept(
                outcome,
                nameOf(listingId),
                placeTag(nameOf(listingId), langOf(listingId)),
              )}
              {/* Where to cancel them, beside the listing it names (WCAG 2.4.4, in context). */}
              {outcome === 'booked' ? (
                <>
                  {' '}
                  <Link
                    href={ownerBookingsHref(listingId)}
                    className="underline underline-offset-4 hover:decoration-2"
                  >
                    {tBookings('seeBookings')}
                  </Link>
                </>
              ) : null}
            </p>
          ))}
        </div>
        <div>
          <Button
            type="submit"
            variant="outline"
            className={WRAPPING_BUTTON}
            aria-disabled={busy !== null || undefined}
          >
            {busy === 'saving'
              ? (texts.saving ?? texts.copying)
              : busy === 'copying'
                ? texts.copying
                : texts.button}
          </Button>
        </div>
      </form>
    </section>
  );
}
