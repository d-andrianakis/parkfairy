'use client';

import { Button } from '@parkfairy/ui/components/button';
import { FieldLabel } from '@parkfairy/ui/components/field';
import { Input } from '@parkfairy/ui/components/input';
import { NativeSelect, NativeSelectOption } from '@parkfairy/ui/components/native-select';
import { cn } from '@parkfairy/ui/lib/utils';
import { CalendarClock, LoaderCircle } from 'lucide-react';
import { useFormatter, useLocale, useTranslations, type DateTimeFormatOptions } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState, type ComponentType } from 'react';
import { spokenStayOptions, stayOptions, timeOptions } from '@/i18n/formats';
import { WRAPPING_BUTTON } from '@/lib/wrapping-button';
import { PlainField } from '../plain-field';
import type { DateTimePickerProps, DateTimeValue } from './date-time-picker';
import { useStay, type StayPart } from './stay-fields';

let pickerChunk: Promise<typeof import('./date-time-picker')> | undefined;
function loadPicker() {
  pickerChunk ??= import('./date-time-picker').catch((error: unknown) => {
    pickerChunk = undefined; // let the next hover or press retry
    throw error;
  });
  return pickerChunk;
}

interface DateTimeFieldProps {
  part: StayPart;
  /** Goes on whatever takes the date, so the error summary's link always finds the field. */
  id: string;
  timeId: string;
  dateName: string;
  timeName: string;
  date: string;
  time: string;
  minDate: string;
  maxDate: string;
  times: readonly string[];
  /** Names the field; the native controls add "Date" and "Time" to it. */
  labelledBy: string;
  invalid?: boolean;
  errorId?: string;
}

/**
 * One date and time, picked in one place. The server renders a native date input and time list:
 * the search works without JavaScript, and they work before hydration. They then give way to the
 * picker in the same space, taking along whatever was entered. Someone still using them keeps
 * them until they move on, so nothing is replaced under their hands.
 */
export function DateTimeField({
  part,
  id,
  timeId,
  dateName,
  timeName,
  date,
  time,
  minDate,
  maxDate,
  times,
  labelledBy,
  invalid,
  errorId,
}: DateTimeFieldProps) {
  const t = useTranslations('SearchForm');
  const format = useFormatter();
  const locale = useLocale();
  const popoverId = useId();
  const nativeFields = useRef<HTMLDivElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const timeSelect = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { stay, set, settle } = useStay();
  const value = stay[part];
  const change = useCallback((next: Partial<DateTimeValue>) => set(part, next), [part, set]);
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<{ Picker: ComponentType<DateTimePickerProps> }>();
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const fields = nativeFields.current;
    if (!fields) return undefined;
    const enhance = () =>
      set(part, {
        date: dateInput.current?.value ?? date,
        time: timeSelect.current?.value ?? time,
      });
    if (!fields.contains(document.activeElement)) {
      enhance();
      return undefined;
    }
    const whenLeft = (event: FocusEvent) => {
      // Switching windows blurs the field too, and they will expect it back.
      if (!document.hasFocus() || fields.contains(event.relatedTarget as Node | null)) return;
      enhance();
    };
    fields.addEventListener('focusout', whenLeft);
    return () => fields.removeEventListener('focusout', whenLeft);
  }, [date, time, part, set]);

  // Someone pressed the field and the picker could not load: back to the plain date, focus too.
  useEffect(() => {
    if (unavailable) dateInput.current?.focus();
  }, [unavailable]);

  if (!value || unavailable) {
    const timeLabel = (option: string) => {
      const [hours = 0, minutes = 0] = option.split(':').map(Number);
      return format.dateTime(new Date(Date.UTC(2000, 0, 1, hours, minutes)), {
        ...timeOptions(locale),
        timeZone: 'UTC',
      });
    };
    return (
      // The labels are for screen readers: visible, they would make this taller than the picker's
      // field, and the page would jump when one replaces the other.
      <div ref={nativeFields} className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-2">
        <PlainField data-invalid={invalid}>
          <FieldLabel id={`${id}-label`} htmlFor={id} className="sr-only">
            {t('date')}
          </FieldLabel>
          <Input
            ref={dateInput}
            id={id}
            name={dateName}
            type="date"
            min={minDate}
            max={maxDate}
            defaultValue={value?.date ?? date}
            // "From Date" / "Until Date" also in forms lists and rotors, not just on Tab.
            aria-labelledby={`${labelledBy} ${id}-label`}
            aria-invalid={invalid}
            aria-describedby={errorId}
          />
        </PlainField>
        <PlainField data-invalid={invalid}>
          <FieldLabel id={`${timeId}-label`} htmlFor={timeId} className="sr-only">
            {t('time')}
          </FieldLabel>
          <NativeSelect
            ref={timeSelect}
            id={timeId}
            name={timeName}
            defaultValue={value?.time ?? time}
            aria-labelledby={`${labelledBy} ${timeId}-label`}
            aria-invalid={invalid}
            aria-describedby={errorId}
          >
            {times.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {timeLabel(option)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </PlainField>
      </div>
    );
  }

  const Picker = picker?.Picker;
  const load = () =>
    loadPicker().then(({ DateTimePicker }) => setPicker({ Picker: DateTimePicker }));
  // Ahead of a press, so failing is no loss: the press tries again.
  const prepare = () => void load().catch(() => {});

  function toggle() {
    if (Picker) {
      setOpen(!open);
      return;
    }
    if (loading) return;
    setLoading(true);
    load()
      .then(() => setOpen(true))
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  }

  const when = new Date(`${value.date}T${value.time}:00Z`);
  // Stays can start up to a year ahead: name the year when it is not this one.
  const otherYear = value.date.slice(0, 4) !== format.dateTime(new Date(), { year: 'numeric' });
  const written = (options: DateTimeFormatOptions) =>
    format.dateTime(when, {
      ...options,
      ...(otherYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });

  return (
    <>
      <Button
        ref={trigger}
        id={id}
        type="button"
        // A combobox, so it can say it is invalid (a button can't) and read out its value.
        role="combobox"
        variant="outline"
        className={cn(
          WRAPPING_BUTTON,
          'w-full justify-start border-input py-1.5 text-left font-normal text-foreground',
        )}
        aria-labelledby={labelledBy}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-busy={loading || undefined}
        aria-invalid={invalid}
        aria-describedby={errorId}
        onPointerEnter={prepare}
        onFocus={prepare}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' || open) return;
          event.preventDefault(); // the page would scroll
          toggle();
        }}
      >
        {loading ? (
          <LoaderCircle className="animate-spin" aria-hidden />
        ) : (
          <CalendarClock aria-hidden />
        )}
        {/* The URL can carry anything; a date that won't parse must not take the page down. */}
        {Number.isNaN(when.getTime()) ? t('chooseDateTime') : written(stayOptions(locale))}
      </Button>
      <input type="hidden" name={dateName} value={value.date} />
      <input type="hidden" name={timeName} value={value.time} />
      {/* There from the start: live regions only speak up about what changes inside them. */}
      {part === 'end' ? (
        <p role="status" className="sr-only">
          {stay.moved ? t('untilMoved', { date: written(spokenStayOptions(locale)) }) : null}
        </p>
      ) : null}
      {Picker ? (
        <Picker
          id={popoverId}
          anchor={trigger}
          labelledBy={labelledBy}
          open={open}
          onOpenChange={setOpen}
          onClosed={settle}
          value={value}
          onChange={change}
          minDate={minDate}
          maxDate={maxDate}
          times={times}
        />
      ) : null}
    </>
  );
}
