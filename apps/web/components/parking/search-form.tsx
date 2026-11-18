import {
  addDays,
  AREAS,
  CITIES,
  MAX_BOOKING_DAYS,
  MAX_START_AHEAD_DAYS,
  PARKING_FEATURES,
  SECURITY_FEATURES,
  type ValidationMessage,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import {
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@parkfairy/ui/components/field';
import { Input } from '@parkfairy/ui/components/input';
import { Label } from '@parkfairy/ui/components/label';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@parkfairy/ui/components/native-select';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { getPathname } from '@/i18n/navigation';
import { type SearchErrors, type SearchValues, TIME_OPTIONS } from '@/lib/search';
import { validationArgs } from '@/lib/validation-args';

import { ClientMessages } from '../client-messages';
import { PlainField, PlainFieldError } from '../plain-field';
import { AddressField } from './address-field';
import { DateTimeField } from './date-time-field';
import { NearMeButton } from './near-me-button';
import { StayFields } from './stay-fields';

interface SearchFormProps {
  values: SearchValues;
  errors?: SearchErrors;
  /** Earliest selectable date (today in Athens). */
  minDate: string;
  /** Offer the address field: only where Mapbox is set up (decisions #40, #42). */
  addressSearch?: boolean;
  className?: string;
}

/** Element ids, also the targets of the search page's error summary links. */
export const SEARCH_FIELD_IDS = {
  area: 'search-area',
  place: 'search-place',
  start: 'search-start-date',
  end: 'search-end-date',
  vehicleHeight: 'search-vehicle-height',
  vehicleLength: 'search-vehicle-length',
  vehicleWidth: 'search-vehicle-width',
} as const;

function useValidationText() {
  const tValidation = useTranslations('Validation');
  return (key: ValidationMessage | undefined) =>
    key ? tValidation(key, validationArgs(key)) : undefined;
}

/** A date and half-hour time for one end of the stay, under its legend. */
function WindowFields({
  part,
  date,
  time,
  error,
  minDate,
}: {
  part: 'start' | 'end';
  date: string;
  time: string;
  error?: ValidationMessage;
  minDate: string;
}) {
  const t = useTranslations('SearchForm');
  const errorText = useValidationText();
  const errorId = error ? `search-${part}-error` : undefined;
  const legendId = `search-${part}-legend`;

  return (
    <FieldSet>
      <FieldLegend id={legendId} variant="label">
        {t(part === 'start' ? 'from' : 'until')}
      </FieldLegend>
      <ClientMessages namespaces={CLIENT_NAMESPACES.searchForm}>
        <DateTimeField
          part={part}
          id={SEARCH_FIELD_IDS[part]}
          timeId={`search-${part}-time`}
          dateName={`${part}Date`}
          timeName={`${part}Time`}
          date={date}
          time={time}
          minDate={minDate}
          // A stay can end past the last day it can start on, and From can take Until there.
          maxDate={addDays(
            minDate,
            part === 'start' ? MAX_START_AHEAD_DAYS : MAX_START_AHEAD_DAYS + MAX_BOOKING_DAYS,
          )}
          times={TIME_OPTIONS}
          labelledBy={legendId}
          invalid={error ? true : undefined}
          errorId={errorId}
        />
      </ClientMessages>
      {error ? <PlainFieldError id={errorId}>{errorText(error)}</PlainFieldError> : null}
    </FieldSet>
  );
}

/**
 * Where + from/until search. A plain GET form: results are shareable URLs and the search
 * works without JavaScript ("use my location" and the date picker are enhancements). The
 * server validates and explains problems in the page language, so the browser's own
 * validation bubbles (untranslated) are switched off.
 */
export function SearchForm({
  values,
  errors = {},
  minDate,
  addressSearch = false,
  className,
}: SearchFormProps) {
  const t = useTranslations('SearchForm');
  const tAreas = useTranslations('Areas');
  const tCities = useTranslations('Cities');
  const errorText = useValidationText();
  const locale = useLocale();
  const heldBack = addressSearch && values.place !== '';

  return (
    <form
      action={getPathname({ href: '/search', locale })}
      method="get"
      role="search"
      noValidate
      aria-label={t('label')}
      className={className}
    >
      <FieldGroup className="gap-5">
        <PlainField data-invalid={errors.area ? true : undefined}>
          <FieldLabel htmlFor={SEARCH_FIELD_IDS.area}>{t('where')}</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              id={SEARCH_FIELD_IDS.area}
              name="area"
              defaultValue={values.area}
              aria-invalid={errors.area ? true : undefined}
              aria-describedby={errors.area ? 'search-area-error' : undefined}
              className="min-w-56"
            >
              <NativeSelectOption value="">
                {values.latitude && !values.place ? t('myLocation') : t('chooseArea')}
              </NativeSelectOption>
              {CITIES.map((city) => (
                <NativeSelectOptGroup key={city} label={tCities(city)}>
                  {AREAS.filter((area) => area.city === city).map((area) => (
                    <NativeSelectOption key={area.id} value={area.id}>
                      {tAreas(area.id)}
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
              ))}
            </NativeSelect>
            <ClientMessages namespaces={CLIENT_NAMESPACES.searchForm}>
              <NearMeButton />
            </ClientMessages>
          </div>
          {/* With the address field, a place's are empty until it puts them back (see there). */}
          <input type="hidden" name="latitude" defaultValue={heldBack ? '' : values.latitude} />
          <input type="hidden" name="longitude" defaultValue={heldBack ? '' : values.longitude} />
          <input
            type="hidden"
            name="placeLocale"
            defaultValue={heldBack ? '' : values.placeLocale}
          />
          {errors.area ? (
            <PlainFieldError id="search-area-error">{errorText(errors.area)}</PlainFieldError>
          ) : null}
        </PlainField>
        {addressSearch ? (
          <PlainField data-invalid={errors.place ? true : undefined}>
            <FieldLabel htmlFor={SEARCH_FIELD_IDS.place}>{t('address')}</FieldLabel>
            <ClientMessages namespaces={CLIENT_NAMESPACES.searchForm}>
              <AddressField
                id={SEARCH_FIELD_IDS.place}
                defaultValue={values.place}
                latitude={values.latitude}
                longitude={values.longitude}
                placeLocale={values.placeLocale}
                describedBy={
                  errors.place ? 'search-place-hint search-place-error' : 'search-place-hint'
                }
                invalid={errors.place ? true : undefined}
              />
            </ClientMessages>
            <FieldDescription id="search-place-hint">
              {t('addressHint')} {t('suggestionsBy')}
            </FieldDescription>
            {errors.place ? (
              <PlainFieldError id="search-place-error">{errorText(errors.place)}</PlainFieldError>
            ) : null}
          </PlainField>
        ) : (
          // Without the field, a place in the URL still names the position it came with.
          <input type="hidden" name="place" defaultValue={values.place} />
        )}
        <StayFields>
          <div className="grid gap-5">
            <WindowFields
              part="start"
              date={values.startDate}
              time={values.startTime}
              error={errors.start}
              minDate={minDate}
            />
            <WindowFields
              part="end"
              date={values.endDate}
              time={values.endTime}
              error={errors.end}
              minDate={minDate}
            />
          </div>
        </StayFields>
        <SearchFilters values={values} errors={errors} />
        <Button type="submit" size="lg" className="sm:w-fit">
          <Search aria-hidden />
          {t('submit')}
        </Button>
      </FieldGroup>
    </form>
  );
}

/**
 * A native checkbox, not the Radix one: this form is a plain GET form that works without
 * JavaScript, and Radix's box can't be toggled (or its choice kept) until the page is hydrated.
 */
function FilterCheckbox({
  id,
  name,
  value,
  checked,
  label,
}: {
  id: string;
  name: string;
  value: string;
  checked: boolean;
  label: string;
}) {
  return (
    <div className="flex min-h-6 items-center gap-2">
      <input
        type="checkbox"
        id={id}
        name={name}
        value={value}
        defaultChecked={checked}
        className="size-4 shrink-0 accent-primary"
      />
      <Label htmlFor={id} className="min-h-6 py-0.5 leading-snug font-normal">
        {label}
      </Label>
    </div>
  );
}

/**
 * Filters (5A.1): what the space and the parking must have, and the vehicle's size. One free space
 * with every feature chosen is enough, and a space with no stated limit fits any vehicle.
 */
function SearchFilters({ values, errors }: { values: SearchValues; errors: SearchErrors }) {
  const t = useTranslations('SearchForm');
  const tFeatures = useTranslations('Features');
  const errorText = useValidationText();
  const sizes = [
    {
      part: 'Height',
      field: 'vehicleHeight',
      name: 'vehicleHeightCm',
      value: values.vehicleHeight,
    },
    {
      part: 'Length',
      field: 'vehicleLength',
      name: 'vehicleLengthCm',
      value: values.vehicleLength,
    },
    { part: 'Width', field: 'vehicleWidth', name: 'vehicleWidthCm', value: values.vehicleWidth },
  ] as const;

  return (
    <FieldSet>
      <FieldLegend variant="label">{t('filters')}</FieldLegend>
      <FieldSet>
        <FieldLegend variant="label" className="text-muted-foreground">
          {t('spaceFeatures')}
        </FieldLegend>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {PARKING_FEATURES.map((feature) => (
            <FilterCheckbox
              key={feature}
              id={`search-feature-${feature}`}
              name="features"
              value={feature}
              checked={values.features.includes(feature)}
              label={tFeatures(feature)}
            />
          ))}
        </div>
      </FieldSet>
      <FieldSet>
        <FieldLegend variant="label" className="text-muted-foreground">
          {t('securityFeatures')}
        </FieldLegend>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {SECURITY_FEATURES.map((feature) => (
            <FilterCheckbox
              key={feature}
              id={`search-security-${feature}`}
              name="security"
              value={feature}
              checked={values.security.includes(feature)}
              label={tFeatures(feature)}
            />
          ))}
        </div>
      </FieldSet>
      {/* The hint belongs to the group, so it is read once, not after each of the three fields. */}
      <FieldSet aria-describedby="search-vehicle-hint">
        <FieldLegend variant="label" className="text-muted-foreground">
          {t('vehicleHeading')}
        </FieldLegend>
        <FieldDescription id="search-vehicle-hint">{t('vehicleHint')}</FieldDescription>
        <div className="grid gap-4 sm:grid-cols-3">
          {sizes.map(({ part, field, name, value }) => {
            const error = errors[field];
            const id = SEARCH_FIELD_IDS[field];
            return (
              <PlainField key={name} data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor={id}>{t(`vehicle${part}`)}</FieldLabel>
                <Input
                  id={id}
                  name={name}
                  inputMode="numeric"
                  autoComplete="off"
                  defaultValue={value}
                  // Only the field that is wrong is said to be, and only it hears why.
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-error` : undefined}
                />
                {error ? (
                  <PlainFieldError id={`${id}-error`}>{errorText(error)}</PlainFieldError>
                ) : null}
              </PlainField>
            );
          })}
        </div>
      </FieldSet>
    </FieldSet>
  );
}
