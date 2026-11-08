'use client';

// First: zod must be configured before any schema (in @parkfairy/contracts) is built.
import '@/lib/zod-jitless';
import { saveListingSpaces } from '@parkfairy/api-client';
import {
  LISTING_SPACES_MAX,
  ListingSpacesInputSchema,
  PARKING_FEATURES,
  type ListingSpaceInput,
  type OwnerListing,
  type ParkingFeature,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup, FieldLegend, FieldSet } from '@parkfairy/ui/components/field';
import { Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { FormError } from '@/components/form-error';
import { BookingsLink } from './bookings-link';
import { FormField } from '@/components/form-field';
import { useAnnouncer } from '@/components/use-announcer';
import { useInvalidSubmitStatus } from '@/components/use-invalid-submit-status';
import { listingStepHref } from '@/lib/owner';
import { attempt, useOwnerError } from '@/lib/owner-client';
import { moneyText, parseMoney } from '@/lib/owner-money';
import { useValidationMessage } from '@/lib/use-validation-message';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { CheckboxField, useOptionalLabel } from './fields';
import { useFocusAfterRender, useStepNavigation } from './navigation';
import { StepActions } from './step-actions';

interface Row {
  key: number;
  label: string;
  features: ParkingFeature[];
  rate: string;
}

/** Keyed by row, not position, so removing a row can't move an error onto its neighbour. */
type RowErrors = Record<number, { label?: string | undefined; rate?: string | undefined }>;

const toggled = (features: ParkingFeature[], feature: ParkingFeature, on: boolean) =>
  on ? [...features, feature] : features.filter((item) => item !== feature);

const wholeNumber = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : null);

export function SpacesForm({ listing }: { listing: OwnerListing }) {
  const t = useTranslations('Owner.spaces');
  const tFeatures = useTranslations('Features');
  const locale = useLocale();
  const go = useStepNavigation();
  const message = useValidationMessage();
  const ownerError = useOwnerError();
  const optional = useOptionalLabel();
  const invalid = useInvalidSubmitStatus();
  const { announce, region } = useAnnouncer();
  const focusAfter = useFocusAfterRender();
  const nextKey = useRef(listing.spaces.length);
  const [rows, setRows] = useState<Row[]>(() =>
    listing.spaces.map((space, key) => ({
      key,
      label: space.label,
      features: space.features,
      rate: moneyText(space.hourlyRateMinor, locale),
    })),
  );
  const [prefix, setPrefix] = useState('');
  const [from, setFrom] = useState('1');
  const [count, setCount] = useState('1');
  const [groupFeatures, setGroupFeatures] = useState<ParkingFeature[]>([]);
  const [groupErrors, setGroupErrors] = useState<{ from?: string; count?: string }>({});
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  // The refusal over bookings (#27), whose message gets the way to them while it shows.
  const [bookedFailure, setBookedFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function addGroup() {
    const first = wholeNumber(from);
    const many = wholeNumber(count);
    const room = LISTING_SPACES_MAX - rows.length;
    const errors = {
      ...(first === null ? { from: message('invalid') } : {}),
      ...(many === null || many < 1 ? { count: message('invalid') } : {}),
      ...(many !== null && many > room ? { count: message('tooManySpaces') } : {}),
    };
    setGroupErrors(errors);
    if (first === null || many === null || 'count' in errors) {
      focusAfter('from' in errors ? 'space-from' : 'space-count');
      return;
    }
    const fresh = Array.from({ length: many }, (_, index) => ({
      key: nextKey.current++,
      label: `${prefix.trim()}${first + index}`,
      features: groupFeatures,
      rate: '',
    }));
    setRows((current) => [...current, ...fresh]);
    setFrom(String(first + many));
    announce(t('added', { count: many }));
  }

  function update(key: number, change: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function remove(row: Row, index: number) {
    const next = rows[index + 1] ?? rows[index - 1];
    setRows((current) => current.filter((item) => item.key !== row.key));
    announce(t('removed', { label: row.label || index + 1 }));
    focusAfter(next ? `space-remove-${next.key}` : 'space-prefix');
  }

  function validate(): ListingSpaceInput[] | null {
    const errors: RowErrors = {};
    const spaces = rows.map((row) => {
      const rate = row.rate.trim() === '' ? null : parseMoney(row.rate);
      if (rate === null && row.rate.trim() !== '') {
        errors[row.key] = { rate: message('rateInvalid') };
      }
      return { label: row.label, features: row.features, hourlyRateMinor: rate };
    });
    const parsed = ListingSpacesInputSchema.safeParse({ spaces });
    let general: string | null = null;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const row = rows[Number(issue.path[1])];
        if (row && issue.path[2] === 'label') {
          errors[row.key] = { ...errors[row.key], label: message(issue.message) };
        } else if (!row) general = message(issue.message) ?? null;
      }
    }
    setFailure(general);
    setRowErrors(errors);
    const firstRow = rows.find((row) => errors[row.key]);
    if (firstRow) {
      invalid.report(Object.keys(errors).length);
      focusAfter(`space-${errors[firstRow.key]?.label ? '' : 'rate-'}${firstRow.key}`);
    }
    return parsed.success && !firstRow ? parsed.data.spaces : null;
  }

  async function save(destination: 'next' | 'later') {
    if (saving) return;
    setFailure(null);
    const spaces = validate();
    if (!spaces) return;
    invalid.clear();
    setSaving(true);
    const outcome = await attempt(() =>
      saveListingSpaces({ path: { id: listing.id }, body: { spaces } }),
    );
    if (!outcome.ok) {
      const text = ownerError(outcome.failure);
      setFailure(text);
      setBookedFailure(outcome.failure.code === 'SPACES_BOOKED' ? text : null);
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
        <FieldSet className="rounded-lg border p-4">
          <FieldLegend>{t('addHeading')}</FieldLegend>
          <p className="text-sm text-muted-foreground">{t('addLead')}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              id="space-prefix"
              label={optional(t('prefix'))}
              hint={t('prefixHint')}
              value={prefix}
              maxLength={12}
              onChange={(event) => setPrefix(event.target.value)}
            />
            <FormField
              id="space-from"
              label={t('from')}
              inputMode="numeric"
              value={from}
              error={groupErrors.from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <FormField
              id="space-count"
              label={t('count')}
              inputMode="numeric"
              value={count}
              error={groupErrors.count}
              onChange={(event) => setCount(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {PARKING_FEATURES.map((feature) => (
              <CheckboxField
                key={feature}
                id={`group-${feature}`}
                label={tFeatures(feature)}
                checked={groupFeatures.includes(feature)}
                onChange={(on) => setGroupFeatures((current) => toggled(current, feature, on))}
              />
            ))}
          </div>
          <div>
            <Button type="button" variant="outline" className={WRAPPING_BUTTON} onClick={addGroup}>
              <Plus aria-hidden />
              {t('add')}
            </Button>
          </div>
        </FieldSet>

        <section aria-labelledby="spaces-list-heading" className="grid gap-3">
          <h2 id="spaces-list-heading" className="font-medium">
            {t('listHeading', { count: rows.length })}
          </h2>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('rateHint')}</p>
          )}
          <ul className="grid gap-3">
            {rows.map((row, index) => (
              <li key={row.key}>
                <div
                  role="group"
                  aria-label={t('rowLabel', { number: index + 1 })}
                  className="grid gap-3 rounded-lg border p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
                    <FormField
                      id={`space-${row.key}`}
                      label={t('label', { number: index + 1 })}
                      value={row.label}
                      lang={listing.location.contentLocale}
                      error={rowErrors[row.key]?.label}
                      onChange={(event) => update(row.key, { label: event.target.value })}
                    />
                    <FormField
                      id={`space-rate-${row.key}`}
                      label={optional(t('rate'))}
                      inputMode="decimal"
                      value={row.rate}
                      error={rowErrors[row.key]?.rate}
                      onChange={(event) => update(row.key, { rate: event.target.value })}
                    />
                    <Button
                      id={`space-remove-${row.key}`}
                      type="button"
                      variant="ghost"
                      className={`${WRAPPING_BUTTON} sm:mt-6`}
                      onClick={() => remove(row, index)}
                    >
                      <Trash2 aria-hidden />
                      <span>{t('remove', { label: row.label || index + 1 })}</span>
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {PARKING_FEATURES.map((feature) => (
                      <CheckboxField
                        key={feature}
                        id={`space-${row.key}-${feature}`}
                        label={tFeatures(feature)}
                        ariaLabel={t('featureOf', {
                          feature: tFeatures(feature),
                          label: row.label || index + 1,
                        })}
                        checked={row.features.includes(feature)}
                        onChange={(on) =>
                          update(row.key, { features: toggled(row.features, feature, on) })
                        }
                      />
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <FormError message={failure}>
          {failure && failure === bookedFailure ? <BookingsLink id={listing.id} /> : null}
        </FormError>
        <StepActions saving={saving} onLater={() => void save('later')} />
      </FieldGroup>
    </form>
  );
}
