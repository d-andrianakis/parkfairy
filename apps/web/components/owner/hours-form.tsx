'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { saveListingHours } from '@parkfairy/api-client';
import {
  ListingHoursInputSchema,
  type OpeningPeriod,
  type OwnerListing,
  type OwnerListingProgress,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import { FormError } from '@/components/form-error';
import { useAnnouncer } from '@/components/use-announcer';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { useRouter } from '@/i18n/navigation';
import { listingStepHref } from '@/lib/owner';
import { attempt, useOwnerError } from '@/lib/owner-client';
import {
  ALL_WEEK,
  closedPartProblem,
  DEFAULT_CLOSED_PART,
  daysToPeriods,
  periodsToDays,
  WEEKDAYS,
  WORKING_WEEK,
  type DayHours,
} from '@/lib/owner-hours';
import { TIME_OPTIONS } from '@/lib/search';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import type { OtherListing } from './copy-to-listings';
import { CopyWeeklyHours } from './copy-weekly-hours';
import { CheckboxField, SelectField, SelectOption } from './fields';
import { useFocusAfterRender, useStepNavigation } from './navigation';
import { StepActions } from './step-actions';

const CLOSING_OPTIONS = [...TIME_OPTIONS, '24:00'];

/** 1 June 2026 was a Monday; only the day's name is read from these. */
const weekdayDate = (weekday: number) => new Date(Date.UTC(2026, 5, weekday, 12));

/** The same week written the same way, to tell saved hours from changed ones. */
const sameWeek = (a: OpeningPeriod[], b: OpeningPeriod[]) =>
  JSON.stringify(a.map(({ weekday, opens, closes }) => [weekday, opens, closes])) ===
  JSON.stringify(b.map(({ weekday, opens, closes }) => [weekday, opens, closes]));

/**
 * The week's hours. `otherListings` are the owner's drafts and listings sent back, which can be
 * given these hours (decision #30). `after` goes between the form and that offer, so whatever the
 * page adds there doesn't read as part of the offer's section.
 */
export function HoursForm({
  listing,
  otherListings = [],
  after,
}: {
  listing: OwnerListing;
  otherListings?: OtherListing[];
  after?: ReactNode;
}) {
  const t = useTranslations('Owner.hours');
  const format = useFormatter();
  const go = useStepNavigation();
  const router = useRouter();
  const message = useValidationMessage();
  const ownerError = useOwnerError();
  const invalid = useInvalidSubmitStatus();
  const { announce, region } = useAnnouncer();
  const focusAfter = useFocusAfterRender();
  const [days, setDays] = useState<DayHours[]>(() => periodsToDays(listing.openingHours));
  /** Keyed by weekday, shown on that day's closing time. */
  const [dayErrors, setDayErrors] = useState<Record<number, string>>({});
  /** Keyed by the time's id (`closed-to-1`), shown on whichever of a closed part's times is wrong. */
  const [partErrors, setPartErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** What the server holds, so copying knows whether the page has changed since. */
  const [savedPeriods, setSavedPeriods] = useState<OpeningPeriod[]>(listing.openingHours);
  const unsaved = !sameWeek(daysToPeriods(days), savedPeriods);

  function update(index: number, change: Partial<DayHours>) {
    setDays((current) =>
      current.map((day, position) => (position === index ? { ...day, ...change } : day)),
    );
  }

  /**
   * Checks the week and saves it, staying on the page: the listing's progress when it saved,
   * null when it couldn't (the reason is shown and the focus is on it). Leaves `saving` on after
   * a success, for whoever moves on next.
   */
  async function persist(): Promise<OwnerListingProgress | null> {
    setFailure(null);
    // A closed part outside the hours would make periods the owner never meant.
    const problems = WEEKDAYS.flatMap((weekday, index) => {
      const day = days[index];
      const problem = day?.open ? closedPartProblem(day) : null;
      if (!problem) return [];
      const text = problem.reason === 'order' ? message('closedTimeOrder') : t('closedPartInvalid');
      return [[`closed-${problem.field}-${weekday}`, text ?? ''] as const];
    });
    setPartErrors(Object.fromEntries(problems));
    const [firstProblem] = problems;
    if (firstProblem) {
      setDayErrors({});
      invalid.report(problems.length);
      focusAfter(firstProblem[0]);
      return null;
    }
    const periods = daysToPeriods(days);
    const parsed = ListingHoursInputSchema.safeParse({ periods });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const period = periods[Number(issue?.path[1])];
      const text = message(issue?.message) ?? '';
      if (!period) {
        setDayErrors({});
        setFailure(text);
        return null;
      }
      // The small hours belong to the evening before, which is where the owner set them.
      const smallHours = period.opens === '00:00' && period.closes !== '24:00';
      const weekday = smallHours ? ((period.weekday + 5) % 7) + 1 : period.weekday;
      setDayErrors({ [weekday]: text });
      invalid.report(1);
      focusAfter(`closes-${weekday}`);
      return null;
    }
    setDayErrors({});
    invalid.clear();
    setSaving(true);
    const outcome = await attempt(() =>
      saveListingHours({ path: { id: listing.id }, body: parsed.data }),
    );
    if (!outcome.ok || !outcome.data) {
      setFailure(outcome.ok ? ownerError({}) : ownerError(outcome.failure));
      setSaving(false);
      return null;
    }
    setSavedPeriods(parsed.data.periods);
    return outcome.data;
  }

  async function save(destination: 'next' | 'later') {
    if (saving) return;
    const progress = await persist();
    if (!progress) return;
    const next = progress.nextStep;
    go(destination === 'next' && next ? listingStepHref(listing.id, next) : '/owner');
  }

  /**
   * Copying sends what is saved: changes are saved first, and the owner stays here. The step list
   * and progress come from the server, so they are fetched again to show the step done.
   */
  async function saveBeforeCopy(): Promise<boolean> {
    if (saving) return false;
    const progress = await persist();
    setSaving(false);
    if (progress) router.refresh();
    return progress !== null;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void save('next');
  }

  function preset(hours: DayHours[], announcement: string) {
    setDays(hours.map((day) => ({ ...day })));
    setDayErrors({});
    setPartErrors({});
    announce(announcement);
  }

  return (
    <>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          {invalid.region}
          {region}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className={WRAPPING_BUTTON}
              onClick={() => preset(ALL_WEEK, t('allWeekApplied'))}
            >
              {t('allWeek')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={WRAPPING_BUTTON}
              onClick={() => preset(WORKING_WEEK, t('workingWeekApplied'))}
            >
              {t('workingWeek')}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{t('overnightHint')}</p>
          <ul className="grid gap-3">
            {WEEKDAYS.map((weekday, index) => {
              const day = days[index] ?? { open: false, opens: '08:00', closes: '20:00' };
              const name = format.dateTime(weekdayDate(weekday), { weekday: 'long' });
              return (
                <li
                  key={weekday}
                  className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[10rem_1fr_1fr] sm:items-center"
                >
                  <CheckboxField
                    id={`open-${weekday}`}
                    label={name}
                    ariaLabel={t('openOn', { day: name })}
                    checked={day.open}
                    onChange={(open) => update(index, { open })}
                  />
                  {day.open ? (
                    <>
                      <SelectField
                        id={`opens-${weekday}`}
                        label={t('opens')}
                        aria-label={t('opensOn', { day: name })}
                        value={day.opens}
                        onChange={(event) => update(index, { opens: event.target.value })}
                      >
                        {TIME_OPTIONS.map((time) => (
                          <SelectOption key={time} value={time}>
                            {time}
                          </SelectOption>
                        ))}
                      </SelectField>
                      <SelectField
                        id={`closes-${weekday}`}
                        label={t('closes')}
                        aria-label={t('closesOn', { day: name })}
                        value={day.closes}
                        error={dayErrors[weekday]}
                        onChange={(event) => update(index, { closes: event.target.value })}
                      >
                        {CLOSING_OPTIONS.map((time) => (
                          <SelectOption key={time} value={time}>
                            {time}
                          </SelectOption>
                        ))}
                      </SelectField>
                      <div className="sm:col-span-2 sm:col-start-2">
                        <CheckboxField
                          id={`closed-part-${weekday}`}
                          label={t('closedPart')}
                          ariaLabel={t('closedPartOn', { day: name })}
                          checked={day.closedPart !== undefined}
                          onChange={(on) =>
                            update(index, {
                              closedPart: on ? { ...DEFAULT_CLOSED_PART } : undefined,
                            })
                          }
                        />
                      </div>
                      {day.closedPart ? (
                        <div className="grid gap-3 sm:col-span-2 sm:col-start-2 sm:grid-cols-2">
                          <SelectField
                            id={`closed-from-${weekday}`}
                            label={t('closedFrom')}
                            aria-label={t('closedFromOn', { day: name })}
                            value={day.closedPart.from}
                            error={partErrors[`closed-from-${weekday}`]}
                            onChange={(event) =>
                              update(index, {
                                closedPart: {
                                  to: day.closedPart?.to ?? '',
                                  from: event.target.value,
                                },
                              })
                            }
                          >
                            {TIME_OPTIONS.map((time) => (
                              <SelectOption key={time} value={time}>
                                {time}
                              </SelectOption>
                            ))}
                          </SelectField>
                          <SelectField
                            id={`closed-to-${weekday}`}
                            label={t('closedTo')}
                            aria-label={t('closedToOn', { day: name })}
                            value={day.closedPart.to}
                            error={partErrors[`closed-to-${weekday}`]}
                            onChange={(event) =>
                              update(index, {
                                closedPart: {
                                  from: day.closedPart?.from ?? '',
                                  to: event.target.value,
                                },
                              })
                            }
                          >
                            {TIME_OPTIONS.map((time) => (
                              <SelectOption key={time} value={time}>
                                {time}
                              </SelectOption>
                            ))}
                          </SelectField>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground sm:col-span-2">{t('closed')}</p>
                  )}
                </li>
              );
            })}
          </ul>
          <FormError message={failure} />
          <StepActions saving={saving} onLater={() => void save('later')} />
        </FieldGroup>
      </form>
      {after}
      {otherListings.length > 0 ? (
        <CopyWeeklyHours
          id={listing.id}
          listings={otherListings}
          unsaved={unsaved}
          prepare={saveBeforeCopy}
        />
      ) : null}
    </>
  );
}
