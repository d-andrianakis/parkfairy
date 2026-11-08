'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { saveListingHoursExceptions } from '@parkfairy/api-client';
import {
  addDays,
  HOURS_EXCEPTION_AHEAD_DAYS,
  HOURS_EXCEPTION_LABEL_MAX,
  HOURS_EXCEPTIONS_MAX,
  ListingHoursExceptionsInputSchema,
  type ListingHoursExceptionsInput,
  type OwnerHoursException,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { Plus, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FormError } from '@/components/form-error';
import { BookingsLink } from './bookings-link';
import { FormField } from '@/components/form-field';
import { useAnnouncer } from '@/components/use-announcer';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { TIME_OPTIONS } from '@/lib/search';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { CopyHoursExceptions, type OtherListing } from './copy-hours-exceptions';
import { ChoiceField, SelectField, SelectOption, useOptionalLabel } from './fields';
import { useFocusAfterRender } from './navigation';
import { SaveStatus, type SaveState } from './save-status';

/** Closed all day, open other hours, or closed for part of the day (decision #28). */
type Kind = 'closed' | 'open' | 'part';

interface Row {
  key: number;
  label: string;
  startsOn: string;
  endsOn: string;
  kind: Kind;
  opens: string;
  closes: string;
  closedFrom: string;
  closedTo: string;
}

type Errors = Record<string, string>;

/** Special hours end after they start and by midnight: no point offering 00:00 to close. */
const CLOSING_OPTIONS = [...TIME_OPTIONS.slice(1), '24:00'];

/** The order an entry's fields come in on the page, for finding the first problem. */
const FIELD_ORDER = [
  'startsOn',
  'endsOn',
  'hours.opens',
  'hours.closes',
  'closedHours',
  'closedHours.from',
  'closedHours.to',
  'label',
];

/** Where an issue's path (`exceptions.2.endsOn`) sits on the page; the list itself comes first. */
function pagePosition(path: string): number {
  const [, index, ...field] = path.split('.');
  if (index === undefined) return -1;
  return Number(index) * FIELD_ORDER.length + FIELD_ORDER.indexOf(field.join('.'));
}

const toRow = (exception: OwnerHoursException, key: number): Row => ({
  key,
  label: exception.label ?? '',
  startsOn: exception.startsOn,
  endsOn: exception.endsOn,
  kind: exception.hours ? 'open' : exception.closedHours ? 'part' : 'closed',
  opens: exception.hours?.opens ?? '08:00',
  closes: exception.hours?.closes ?? '14:00',
  closedFrom: exception.closedHours?.from ?? '10:00',
  closedTo: exception.closedHours?.to ?? '14:00',
});

const shareADay = (a: Row, b: Row) => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;

/**
 * Closures and special hours, saved together by one button: an entry is only meaningful once its
 * dates are both in, so nothing saves field by field here. Open whatever the listing's status.
 * `today` comes from the server, so the date fields' range can't differ after hydration.
 * `otherListings` are the owner's others, which can be given what is saved here.
 */
export function HoursExceptionsForm({
  id,
  exceptions,
  today,
  otherListings = [],
}: {
  id: string;
  exceptions: OwnerHoursException[];
  today: string;
  otherListings?: OtherListing[];
}) {
  const t = useTranslations('Owner.closures');
  const format = useFormatter();
  const message = useValidationMessage();
  const ownerError = useOwnerError();
  const optional = useOptionalLabel();
  const invalid = useInvalidSubmitStatus();
  const { announce, region } = useAnnouncer();
  const focusAfter = useFocusAfterRender();
  const saveButton = useRef<HTMLButtonElement>(null);
  const nextKey = useRef(exceptions.length);
  const [rows, setRows] = useState<Row[]>(() => exceptions.map(toRow));
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  // The refusal over bookings (#27), whose message gets the way to them while it shows.
  const [bookedFailure, setBookedFailure] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  /** How many entries are stored, and whether the page has changed since: what copying copies. */
  const [stored, setStored] = useState(exceptions.length);
  const [unsaved, setUnsaved] = useState(false);
  const saving = state === 'saving';
  const latest = addDays(today, HOURS_EXCEPTION_AHEAD_DAYS);
  const fromHint = t('fromHint', {
    latest: format.dateTime(new Date(`${latest}T12:00:00Z`), {
      dateStyle: 'long',
      timeZone: 'UTC',
    }),
  });

  // A save started with Enter in a field leaves the focus on that field, which a re-render may
  // still take away: rather than the top of the page, the owner lands on Save, beside "Saved".
  useEffect(() => {
    if (state !== 'saved') return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) saveButton.current?.focus();
  }, [state]);

  const changed = () => {
    setState('idle');
    setUnsaved(true);
  };

  const update = (key: number, change: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
    changed();
  };

  /** An overlap names the period it runs into, which in a list of thirty saves a search. */
  function overlapMessage(index: number): string | undefined {
    const row = rows[index];
    const other = row ? rows.findIndex((item, at) => at !== index && shareADay(row, item)) : -1;
    return other < 0 ? undefined : t('overlapWith', { number: other + 1 });
  }

  function collect(): ListingHoursExceptionsInput | null {
    const parsed = ListingHoursExceptionsInputSchema.safeParse({
      exceptions: rows.map((row) => ({
        label: row.label.trim() || null,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        hours: row.kind === 'open' ? { opens: row.opens, closes: row.closes } : null,
        closedHours: row.kind === 'part' ? { from: row.closedFrom, to: row.closedTo } : null,
      })),
    });
    if (parsed.success) {
      setErrors({});
      return parsed.data;
    }
    const found: Errors = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      const overlap =
        issue.message === 'exceptionOverlap' ? overlapMessage(Number(issue.path[1])) : undefined;
      found[path] ??= overlap ?? message(issue.message) ?? '';
    }
    setErrors(found);
    invalid.report(Object.keys(found).length);
    // Only the list's length is about no field in particular.
    if (found.exceptions) setFailure(found.exceptions);
    // The first problem as the page reads, not as the schema found them.
    const [first] = Object.keys(found)
      .filter((path) => path !== 'exceptions')
      .sort((a, b) => pagePosition(a) - pagePosition(b));
    if (first) focusAfter(`closure-${first}`);
    return null;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setFailure(null);
    const body = collect();
    if (!body) return;
    invalid.clear();
    setState('saving');
    const outcome = await attempt(() => saveListingHoursExceptions({ path: { id }, body }));
    if (!outcome.ok) {
      const text = ownerError(outcome.failure);
      setFailure(text);
      setBookedFailure(outcome.failure.code === 'LISTING_BOOKED' ? text : null);
      setState('idle');
      return;
    }
    // What the server keeps, soonest first. Entries keep their keys, so nothing on the page is
    // rebuilt: a first day is unique, since entries never share a day.
    const saved = outcome.data?.exceptions ?? [];
    const keyOf = new Map(rows.map((row) => [row.startsOn, row.key]));
    setRows(
      saved.map((exception) =>
        toRow(exception, keyOf.get(exception.startsOn) ?? nextKey.current++),
      ),
    );
    setStored(saved.length);
    setUnsaved(false);
    setState('saved');
  }

  return (
    <>
      <form onSubmit={(event) => void save(event)} noValidate>
        <FieldGroup>
          {invalid.region}
          {region}
          {rows.length === 0 ? <p className="text-muted-foreground">{t('empty')}</p> : null}
          {rows.map((row, index) => {
            const number = index + 1;
            const heading = `closure-${row.key}-heading`;
            // As the schema's issues name them, and as the fields' ids carry them.
            const path = {
              startsOn: `exceptions.${index}.startsOn`,
              endsOn: `exceptions.${index}.endsOn`,
              opens: `exceptions.${index}.hours.opens`,
              closes: `exceptions.${index}.hours.closes`,
              closedFrom: `exceptions.${index}.closedHours.from`,
              closedTo: `exceptions.${index}.closedHours.to`,
              label: `exceptions.${index}.label`,
            };
            return (
              <div
                key={row.key}
                role="group"
                aria-labelledby={heading}
                className="grid gap-4 rounded-lg border p-4"
              >
                <h2 id={heading} className="text-base font-semibold">
                  {t('group', { number })}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField
                    id={`closure-${path.startsOn}`}
                    label={t('from')}
                    hint={fromHint}
                    type="date"
                    // An entry already running keeps the first day it was saved with.
                    min={row.startsOn && row.startsOn < today ? row.startsOn : today}
                    max={latest}
                    value={row.startsOn}
                    error={errors[path.startsOn]}
                    onChange={(event) => {
                      const startsOn = event.target.value;
                      // A single day is the usual case: the last day follows until it's set.
                      const endsOn =
                        row.endsOn === '' || row.endsOn < startsOn ? startsOn : row.endsOn;
                      update(row.key, { startsOn, endsOn });
                    }}
                  />
                  <FormField
                    id={`closure-${path.endsOn}`}
                    label={t('to')}
                    type="date"
                    min={row.startsOn || today}
                    max={latest}
                    value={row.endsOn}
                    error={errors[path.endsOn]}
                    onChange={(event) => update(row.key, { endsOn: event.target.value })}
                  />
                </div>
                <ChoiceField<Kind>
                  id={`closure-${index}-kind`}
                  legend={t('kind')}
                  value={row.kind}
                  onChange={(kind) => update(row.key, { kind })}
                  choices={[
                    { value: 'closed', label: t('closedAllDay') },
                    { value: 'open', label: t('openOther') },
                    { value: 'part', label: t('closedPart'), description: t('closedPartHint') },
                  ]}
                />
                {row.kind === 'open' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField
                      id={`closure-${path.opens}`}
                      label={t('opens')}
                      value={row.opens}
                      onChange={(event) => update(row.key, { opens: event.target.value })}
                    >
                      {TIME_OPTIONS.map((time) => (
                        <SelectOption key={time} value={time}>
                          {time}
                        </SelectOption>
                      ))}
                    </SelectField>
                    <SelectField
                      id={`closure-${path.closes}`}
                      label={t('closes')}
                      value={row.closes}
                      error={errors[path.closes]}
                      onChange={(event) => update(row.key, { closes: event.target.value })}
                    >
                      {CLOSING_OPTIONS.map((time) => (
                        <SelectOption key={time} value={time}>
                          {time}
                        </SelectOption>
                      ))}
                    </SelectField>
                  </div>
                ) : null}
                {row.kind === 'part' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField
                      id={`closure-${path.closedFrom}`}
                      label={t('closedFrom')}
                      value={row.closedFrom}
                      onChange={(event) => update(row.key, { closedFrom: event.target.value })}
                    >
                      {TIME_OPTIONS.map((time) => (
                        <SelectOption key={time} value={time}>
                          {time}
                        </SelectOption>
                      ))}
                    </SelectField>
                    <SelectField
                      id={`closure-${path.closedTo}`}
                      label={t('closedTo')}
                      value={row.closedTo}
                      error={errors[path.closedTo]}
                      onChange={(event) => update(row.key, { closedTo: event.target.value })}
                    >
                      {CLOSING_OPTIONS.map((time) => (
                        <SelectOption key={time} value={time}>
                          {time}
                        </SelectOption>
                      ))}
                    </SelectField>
                  </div>
                ) : null}
                <FormField
                  id={`closure-${path.label}`}
                  label={optional(t('note', { number }))}
                  hint={t('noteHint')}
                  maxLength={HOURS_EXCEPTION_LABEL_MAX}
                  value={row.label}
                  error={errors[path.label]}
                  onChange={(event) => update(row.key, { label: event.target.value })}
                />
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    className={WRAPPING_BUTTON}
                    onClick={() => {
                      setRows((current) => current.filter((item) => item.key !== row.key));
                      setErrors({});
                      changed();
                      announce(t('removed', { number }));
                      focusAfter('add-closure');
                    }}
                  >
                    <Trash2 aria-hidden />
                    {t('remove', { number })}
                  </Button>
                </div>
              </div>
            );
          })}
          {rows.length < HOURS_EXCEPTIONS_MAX ? (
            <div>
              <Button
                id="add-closure"
                type="button"
                variant="outline"
                className={WRAPPING_BUTTON}
                onClick={() => {
                  setRows((current) => [
                    ...current,
                    toRow(
                      { label: null, startsOn: '', endsOn: '', hours: null, closedHours: null },
                      nextKey.current++,
                    ),
                  ]);
                  changed();
                  focusAfter(`closure-exceptions.${rows.length}.startsOn`);
                }}
              >
                <Plus aria-hidden />
                {t('add')}
              </Button>
            </div>
          ) : (
            // Where the button was, so whoever looks for it learns why it went.
            <p className="text-sm text-muted-foreground">
              {t('limit', { max: HOURS_EXCEPTIONS_MAX })}
            </p>
          )}
          <FormError message={failure}>
            {failure && failure === bookedFailure ? <BookingsLink id={id} /> : null}
          </FormError>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SaveStatus state={state} />
            <Button
              ref={saveButton}
              type="submit"
              className={WRAPPING_BUTTON}
              aria-disabled={saving || undefined}
            >
              {t('save')}
            </Button>
          </div>
        </FieldGroup>
      </form>
      {otherListings.length > 0 && stored > 0 ? (
        <CopyHoursExceptions id={id} listings={otherListings} unsaved={unsaved} />
      ) : null}
    </>
  );
}
