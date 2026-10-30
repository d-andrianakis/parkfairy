import {
  addDays,
  AREAS,
  CITIES,
  MAX_START_AHEAD_DAYS,
  type ValidationMessage,
} from '@parkfairy/contracts';
import { Button } from '@parkfairy/ui/components/button';
import { FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@parkfairy/ui/components/field';
import { Input } from '@parkfairy/ui/components/input';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@parkfairy/ui/components/native-select';
import { Search } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { timeOptions } from '@/i18n/formats';
import { getPathname } from '@/i18n/navigation';
import { TIME_OPTIONS, type SearchErrors, type SearchValues } from '@/lib/search';
import { validationArgs } from '@/lib/validation-args';
import { ClientMessages } from '../client-messages';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { PlainField, PlainFieldError } from '../plain-field';
import { NearMeButton } from './near-me-button';

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

/** Date + half-hour time for one end of the stay, grouped under its legend. */
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
  const format = useFormatter();
  const locale = useLocale();
  const errorText = useValidationText();
  const invalid = error ? true : undefined;
  const errorId = error ? `search-${part}-error` : undefined;
  const legendId = `search-${part}-legend`;
  const timeLabel = (option: string) => {
    const [hours = 0, minutes = 0] = option.split(':').map(Number);
    return format.dateTime(new Date(Date.UTC(2000, 0, 1, hours, minutes)), {
      ...timeOptions(locale),
      timeZone: 'UTC',
    });
  };

  return (
    <FieldSet>
      <FieldLegend id={legendId} variant="label">
        {t(part === 'start' ? 'from' : 'until')}
      </FieldLegend>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-2">
        <PlainField data-invalid={invalid}>
          <FieldLabel
            id={`search-${part}-date-label`}
            htmlFor={SEARCH_FIELD_IDS[part]}
            className="text-xs text-muted-foreground"
          >
            {t('date')}
          </FieldLabel>
          <Input
            id={SEARCH_FIELD_IDS[part]}
            name={`${part}Date`}
            type="date"
            min={minDate}
            max={addDays(minDate, MAX_START_AHEAD_DAYS)}
            defaultValue={date}
            // "From Date" / "Until Date" also in forms lists and rotors, not just on Tab.
            aria-labelledby={`${legendId} search-${part}-date-label`}
            aria-invalid={invalid}
            aria-describedby={errorId}
          />
        </PlainField>
        <PlainField data-invalid={invalid}>
          <FieldLabel
            id={`search-${part}-time-label`}
            htmlFor={`search-${part}-time`}
            className="text-xs text-muted-foreground"
          >
            {t('time')}
          </FieldLabel>
          <NativeSelect
            id={`search-${part}-time`}
            name={`${part}Time`}
            defaultValue={time}
            aria-labelledby={`${legendId} search-${part}-time-label`}
            aria-invalid={invalid}
            aria-describedby={errorId}
          >
            {TIME_OPTIONS.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {timeLabel(option)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </PlainField>
      </div>
      {error ? <PlainFieldError id={errorId}>{errorText(error)}</PlainFieldError> : null}
    </FieldSet>
  );
}

/**
 * Where + from/until search. A plain GET form: results are shareable URLs and the search
 * works without JavaScript ("use my location" is the only scripted part). The server
 * validates and explains problems in the page language, so the browser's own validation
 * bubbles (untranslated) are switched off.
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
        <Button type="submit" size="lg" className="sm:w-fit">
          <Search aria-hidden />
          {t('submit')}
        </Button>
      </FieldGroup>
    </form>
  );
}
