import {
  addDays,
  AREAS,
  CITIES,
  MAX_BOOKING_DAYS,
  MAX_START_AHEAD_DAYS,
  type ValidationMessage,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@parkfairy/ui/components/field';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@parkfairy/ui/components/native-select';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { getPathname } from '@/i18n/navigation';
import { TIME_OPTIONS, type SearchErrors, type SearchValues } from '@/lib/search';
import { validationArgs } from '@/lib/validation-args';
import { ClientMessages } from '../client-messages';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { PlainField, PlainFieldError } from '../plain-field';
import { DateTimeField } from './date-time-field';
import { NearMeButton } from './near-me-button';
import { StayFields } from './stay-fields';

interface SearchFormProps {
  values: SearchValues;
  errors?: SearchErrors;
  /** Earliest selectable date (today in Athens). */
  minDate: string;
  className?: string;
}

/** Element ids, also the targets of the search page's error summary links. */
export const SEARCH_FIELD_IDS = {
  area: 'search-area',
  start: 'search-start-date',
  end: 'search-end-date',
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
export function SearchForm({ values, errors = {}, minDate, className }: SearchFormProps) {
  const t = useTranslations('SearchForm');
  const tAreas = useTranslations('Areas');
  const tCities = useTranslations('Cities');
  const errorText = useValidationText();
  const locale = useLocale();

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
                {values.latitude ? t('myLocation') : t('chooseArea')}
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
          <input type="hidden" name="latitude" defaultValue={values.latitude} />
          <input type="hidden" name="longitude" defaultValue={values.longitude} />
          {errors.area ? (
            <PlainFieldError id="search-area-error">{errorText(errors.area)}</PlainFieldError>
          ) : null}
        </PlainField>
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
        <Button type="submit" size="lg" className="sm:w-fit">
          <Search aria-hidden />
          {t('submit')}
        </Button>
      </FieldGroup>
    </form>
  );
}
