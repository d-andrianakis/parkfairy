'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { saveListingHours } from '@parkfairy/api-client';
import { ListingHoursInputSchema, type OwnerListing } from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup } from '@parkfairy/ui/components/field';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormError } from '@/components/form-error';
import { useAnnouncer } from '@/components/use-announcer';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
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
import { CheckboxField, SelectField, SelectOption } from './fields';
import { useFocusAfterRender, useStepNavigation } from './navigation';
import { StepActions } from './step-actions';

const CLOSING_OPTIONS = [...TIME_OPTIONS, '24:00'];

/** 1 June 2026 was a Monday; only the day's name is read from these. */
const weekdayDate = (weekday: number) => new Date(Date.UTC(2026, 5, weekday, 12));

export function HoursForm({ listing }: { listing: OwnerListing }) {
  const t = useTranslations('Owner.hours');
  const format = useFormatter();
  const go = useStepNavigation();
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

  function update(index: number, change: Partial<DayHours>) {
    setDays((current) =>
      current.map((day, position) => (position === index ? { ...day, ...change } : day)),
    );
  }

  async function save(destination: 'next' | 'later') {
    if (saving) return;
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
      return;
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
        return;
      }
      // The small hours belong to the evening before, which is where the owner set them.
      const smallHours = period.opens === '00:00' && period.closes !== '24:00';
      const weekday = smallHours ? ((period.weekday + 5) % 7) + 1 : period.weekday;
      setDayErrors({ [weekday]: text });
      invalid.report(1);
      focusAfter(`closes-${weekday}`);
      return;
    }
    setDayErrors({});
    invalid.clear();
    setSaving(true);
    const outcome = await attempt(() =>
      saveListingHours({ path: { id: listing.id }, body: parsed.data }),
    );
    if (!outcome.ok) {
      setFailure(ownerError(outcome.failure));
      setSaving(false);
      return;
    }
    const next = outcome.data?.nextStep;
    go(destination === 'next' && next ? listingStepHref(listing.id, next) : '/owner');
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
                          update(index, { closedPart: on ? { ...DEFAULT_CLOSED_PART } : undefined })
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
  );
}
