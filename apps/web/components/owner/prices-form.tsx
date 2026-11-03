'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { saveListingPrices } from '@parkfairy/api-client';
import {
  BOOKING_GAPS,
  CANCELLATION_POLICIES,
  DATED_PRICES_MAX,
  LONG_STAY_DISCOUNTS_MAX,
  ListingPricesInputSchema,
  PRICE_LABEL_MAX,
  type CancellationPolicy,
  type ListingPricesInput,
  type OwnerListing,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup, FieldLegend, FieldSet } from '@parkfairy/ui/components/field';
import { Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { FormError } from '@/components/form-error';
import { FormField } from '@/components/form-field';
import { useAnnouncer } from '@/components/use-announcer';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { listingStepHref } from '@/lib/owner';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { moneyText, parseMoney } from '@/lib/owner-money';
import { TIME_OPTIONS } from '@/lib/search';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { CheckboxField, ChoiceField, SelectField, SelectOption, useOptionalLabel } from './fields';
import { useFocusAfterRender, useStepNavigation } from './navigation';
import { StepActions } from './step-actions';

interface DatedRow {
  key: number;
  label: string;
  startsOn: string;
  endsOn: string;
  rate: string;
}

interface DiscountRow {
  key: number;
  minDays: string;
  percent: string;
}

type Errors = Record<string, string>;

/** Money the owner must give: empty and malformed both fail. */
const required = (text: string) => parseMoney(text) ?? -1;

export function PricesForm({ listing }: { listing: OwnerListing }) {
  const t = useTranslations('Owner.prices');
  const locale = useLocale();
  const go = useStepNavigation();
  const message = useValidationMessage();
  const ownerError = useOwnerError();
  const optional = useOptionalLabel();
  const invalid = useInvalidSubmitStatus();
  const { announce, region } = useAnnouncer();
  const focusAfter = useFocusAfterRender();
  const { prices } = listing;
  const nextKey = useRef(prices.datedPrices.length + prices.longStayDiscounts.length);

  const [hourly, setHourly] = useState(moneyText(prices.hourlyRateMinor, locale));
  const [dailyMax, setDailyMax] = useState(moneyText(prices.dailyMaxMinor, locale));
  const [gap, setGap] = useState(String(prices.bookingGapMinutes));
  const [policy, setPolicy] = useState<CancellationPolicy | null>(prices.cancellationPolicy);
  const [hasWeekend, setHasWeekend] = useState(prices.weekendRateMinor !== null);
  const [weekend, setWeekend] = useState(moneyText(prices.weekendRateMinor, locale));
  const [hasNight, setHasNight] = useState(prices.night !== null);
  const [nightRate, setNightRate] = useState(moneyText(prices.night?.rateMinor ?? null, locale));
  const [nightFrom, setNightFrom] = useState(prices.night?.from ?? '22:00');
  const [nightTo, setNightTo] = useState(prices.night?.to ?? '06:00');
  const [dated, setDated] = useState<DatedRow[]>(() =>
    prices.datedPrices.map((row, key) => ({
      key,
      label: row.label ?? '',
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      rate: moneyText(row.rateMinor, locale),
    })),
  );
  const [discounts, setDiscounts] = useState<DiscountRow[]>(() =>
    prices.longStayDiscounts.map((row, index) => ({
      key: prices.datedPrices.length + index,
      minDays: String(row.minDays),
      percent: String(row.percent),
    })),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateDated = (key: number, change: Partial<DatedRow>) =>
    setDated((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const updateDiscount = (key: number, change: Partial<DiscountRow>) =>
    setDiscounts((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  function collect(): ListingPricesInput | null {
    const input = {
      hourlyRateMinor: required(hourly),
      dailyMaxMinor: dailyMax.trim() === '' ? null : required(dailyMax),
      bookingGapMinutes: Number(gap),
      cancellationPolicy: policy,
      weekendRateMinor: hasWeekend ? required(weekend) : null,
      night: hasNight ? { rateMinor: required(nightRate), from: nightFrom, to: nightTo } : null,
      datedPrices: dated.map((row) => ({
        label: row.label.trim() || null,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        rateMinor: required(row.rate),
      })),
      longStayDiscounts: discounts.map((row) => ({
        minDays: Number(row.minDays),
        percent: Number(row.percent),
      })),
    };
    const parsed = ListingPricesInputSchema.safeParse(input);
    if (parsed.success) {
      setErrors({});
      return parsed.data;
    }
    const found: Errors = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      found[path] ??= message(issue.message) ?? '';
    }
    setErrors(found);
    invalid.report(Object.keys(found).length);
    const first = Object.keys(found)[0];
    // A group of radios has no field of its own: the focus goes to its first radio.
    if (first) {
      focusAfter(
        first === 'cancellationPolicy'
          ? `price-cancellationPolicy-${CANCELLATION_POLICIES[0]}`
          : `price-${first}`,
      );
    }
    return null;
  }

  async function save(destination: 'next' | 'later') {
    if (saving) return;
    setFailure(null);
    const body = collect();
    if (!body) return;
    invalid.clear();
    setSaving(true);
    const outcome = await attempt(() => saveListingPrices({ path: { id: listing.id }, body }));
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

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {invalid.region}
        {region}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="price-hourlyRateMinor"
            label={t('hourly')}
            hint={t('moneyHint')}
            inputMode="decimal"
            value={hourly}
            error={errors.hourlyRateMinor}
            onChange={(event) => setHourly(event.target.value)}
          />
          <FormField
            id="price-dailyMaxMinor"
            label={optional(t('dailyMax'))}
            hint={t('dailyMaxHint')}
            inputMode="decimal"
            value={dailyMax}
            error={errors.dailyMaxMinor}
            onChange={(event) => setDailyMax(event.target.value)}
          />
        </div>

        <ChoiceField<CancellationPolicy>
          id="price-cancellationPolicy"
          legend={t('policy')}
          value={policy}
          onChange={setPolicy}
          error={errors.cancellationPolicy}
          choices={CANCELLATION_POLICIES.map((value) => ({
            value,
            label: t(`policies.${value}.label`),
            description: t(`policies.${value}.text`),
          }))}
        />

        <SelectField
          id="price-bookingGapMinutes"
          label={t('gap')}
          hint={t('gapHint')}
          value={gap}
          onChange={(event) => setGap(event.target.value)}
        >
          {BOOKING_GAPS.map((minutes) => (
            <SelectOption key={minutes} value={String(minutes)}>
              {t('gapOption', { minutes })}
            </SelectOption>
          ))}
        </SelectField>

        <FieldSet className="rounded-lg border p-4">
          <FieldLegend>{t('specialHeading')}</FieldLegend>
          <p className="text-sm text-muted-foreground">{t('specialLead')}</p>

          <CheckboxField
            id="has-weekend"
            label={t('weekendToggle')}
            checked={hasWeekend}
            onChange={setHasWeekend}
          />
          {hasWeekend ? (
            <FormField
              id="price-weekendRateMinor"
              label={t('weekendRate')}
              inputMode="decimal"
              value={weekend}
              error={errors.weekendRateMinor}
              onChange={(event) => setWeekend(event.target.value)}
            />
          ) : null}

          <CheckboxField
            id="has-night"
            label={t('nightToggle')}
            checked={hasNight}
            onChange={setHasNight}
          />
          {hasNight ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                id="price-night.rateMinor"
                label={t('nightRate')}
                inputMode="decimal"
                value={nightRate}
                error={errors['night.rateMinor']}
                onChange={(event) => setNightRate(event.target.value)}
              />
              <SelectField
                id="price-night"
                label={t('nightFrom')}
                value={nightFrom}
                error={errors.night}
                onChange={(event) => setNightFrom(event.target.value)}
              >
                {TIME_OPTIONS.map((time) => (
                  <SelectOption key={time} value={time}>
                    {time}
                  </SelectOption>
                ))}
              </SelectField>
              <SelectField
                id="price-night-to"
                label={t('nightTo')}
                value={nightTo}
                onChange={(event) => setNightTo(event.target.value)}
              >
                {TIME_OPTIONS.map((time) => (
                  <SelectOption key={time} value={time}>
                    {time}
                  </SelectOption>
                ))}
              </SelectField>
            </div>
          ) : null}
        </FieldSet>

        <FieldSet className="rounded-lg border p-4">
          <FieldLegend>{t('datedHeading')}</FieldLegend>
          <p className="text-sm text-muted-foreground">{t('datedLead')}</p>
          {dated.map((row, index) => (
            <div
              key={row.key}
              role="group"
              aria-label={t('datedGroup', { number: index + 1 })}
              className="grid gap-3 rounded-lg border p-3"
            >
              <FormField
                id={`price-datedPrices.${index}.label`}
                label={optional(t('datedLabel', { number: index + 1 }))}
                maxLength={PRICE_LABEL_MAX}
                value={row.label}
                onChange={(event) => updateDated(row.key, { label: event.target.value })}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField
                  id={`price-datedPrices.${index}.startsOn`}
                  label={t('datedFrom')}
                  type="date"
                  value={row.startsOn}
                  error={errors[`datedPrices.${index}.startsOn`]}
                  onChange={(event) => updateDated(row.key, { startsOn: event.target.value })}
                />
                <FormField
                  id={`price-datedPrices.${index}.endsOn`}
                  label={t('datedTo')}
                  type="date"
                  value={row.endsOn}
                  error={errors[`datedPrices.${index}.endsOn`]}
                  onChange={(event) => updateDated(row.key, { endsOn: event.target.value })}
                />
                <FormField
                  id={`price-datedPrices.${index}.rateMinor`}
                  label={t('datedRate')}
                  inputMode="decimal"
                  value={row.rate}
                  error={errors[`datedPrices.${index}.rateMinor`]}
                  onChange={(event) => updateDated(row.key, { rate: event.target.value })}
                />
              </div>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  className={WRAPPING_BUTTON}
                  onClick={() => {
                    setDated((rows) => rows.filter((item) => item.key !== row.key));
                    setErrors({});
                    announce(t('removedDated', { number: index + 1 }));
                    focusAfter('add-dated');
                  }}
                >
                  <Trash2 aria-hidden />
                  {t('removeDated', { number: index + 1 })}
                </Button>
              </div>
            </div>
          ))}
          {dated.length < DATED_PRICES_MAX ? (
            <div>
              <Button
                id="add-dated"
                type="button"
                variant="outline"
                className={WRAPPING_BUTTON}
                onClick={() => {
                  setDated((rows) => [
                    ...rows,
                    { key: nextKey.current++, label: '', startsOn: '', endsOn: '', rate: '' },
                  ]);
                  focusAfter(`price-datedPrices.${dated.length}.label`);
                }}
              >
                <Plus aria-hidden />
                {t('addDated')}
              </Button>
            </div>
          ) : null}
        </FieldSet>

        <FieldSet className="rounded-lg border p-4">
          <FieldLegend>{t('longStayHeading')}</FieldLegend>
          <p className="text-sm text-muted-foreground">{t('longStayLead')}</p>
          {discounts.map((row, index) => (
            <div
              key={row.key}
              role="group"
              aria-label={t('longStayGroup', { number: index + 1 })}
              className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3"
            >
              <FormField
                id={`price-longStayDiscounts.${index}.minDays`}
                label={t('longStayDays', { number: index + 1 })}
                inputMode="numeric"
                value={row.minDays}
                error={errors[`longStayDiscounts.${index}.minDays`]}
                onChange={(event) => updateDiscount(row.key, { minDays: event.target.value })}
              />
              <FormField
                id={`price-longStayDiscounts.${index}.percent`}
                label={t('longStayPercent')}
                inputMode="numeric"
                value={row.percent}
                error={errors[`longStayDiscounts.${index}.percent`]}
                onChange={(event) => updateDiscount(row.key, { percent: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                className={`${WRAPPING_BUTTON} self-end`}
                onClick={() => {
                  setDiscounts((rows) => rows.filter((item) => item.key !== row.key));
                  setErrors({});
                  announce(t('removedLongStay', { number: index + 1 }));
                  focusAfter('add-discount');
                }}
              >
                <Trash2 aria-hidden />
                {t('removeLongStay', { number: index + 1 })}
              </Button>
            </div>
          ))}
          {discounts.length < LONG_STAY_DISCOUNTS_MAX ? (
            <div>
              <Button
                id="add-discount"
                type="button"
                variant="outline"
                className={WRAPPING_BUTTON}
                onClick={() => {
                  setDiscounts((rows) => [
                    ...rows,
                    { key: nextKey.current++, minDays: '7', percent: '10' },
                  ]);
                  focusAfter(`price-longStayDiscounts.${discounts.length}.minDays`);
                }}
              >
                <Plus aria-hidden />
                {t('addLongStay')}
              </Button>
            </div>
          ) : null}
        </FieldSet>

        <FormError message={failure} />
        <StepActions saving={saving} onLater={() => void save('later')} />
      </FieldGroup>
    </form>
  );
}
