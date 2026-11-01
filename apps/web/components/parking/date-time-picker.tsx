'use client';

import { Calendar } from '@parkfairy/ui/components/calendar';
import { Popover, PopoverAnchor, PopoverContent } from '@parkfairy/ui/components/popover';
import { ScrollArea, ScrollBar } from '@parkfairy/ui/components/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@parkfairy/ui/components/toggle-group';
import { useFormatter, useLocale, useTimeZone, useTranslations } from 'next-intl';
import { memo, useEffect, useId, useRef, type RefObject } from 'react';
import { hourOptions } from '@/i18n/formats';

/** Athens wall-clock values, as the search form submits them: `YYYY-MM-DD` and `HH:MM`. */
export interface DateTimeValue {
  date: string;
  time: string;
}

export interface DateTimePickerProps {
  id: string;
  /** The field that opens this; it stays outside, so it is there before this chunk loads. */
  anchor: RefObject<HTMLButtonElement | null>;
  labelledBy: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Once it has gone and the focus has landed, so nothing said now is cut off by that. */
  onClosed: () => void;
  value: DateTimeValue;
  /** Must not change between renders: the calendar is memoised on it. */
  onChange: (change: Partial<DateTimeValue>) => void;
  minDate: string;
  maxDate: string;
  times: readonly string[];
}

/** Noon UTC falls on the same calendar day in Athens all year, in any visitor's zone. */
const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);

function TimeColumn({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const chosen = useRef<HTMLButtonElement>(null);
  const labelId = useId();

  // Open on the current choice, not at midnight. Set by hand: scrollIntoView could move the page.
  useEffect(() => {
    const item = chosen.current;
    const viewport = item?.closest<HTMLElement>('[data-slot=scroll-area-viewport]');
    if (!item || !viewport) return;
    viewport.scrollTop = item.offsetTop - (viewport.clientHeight - item.offsetHeight) / 2;
    viewport.scrollLeft = item.offsetLeft - (viewport.clientWidth - item.offsetWidth) / 2;
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-col sm:h-full">
      <span id={labelId} className="px-3 pt-2 text-xs whitespace-nowrap text-muted-foreground">
        {label}
      </span>
      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <ToggleGroup
          type="single"
          // One tab stop, then arrow keys: otherwise the minutes are 24 tabs past the first hour.
          role="radiogroup"
          aria-labelledby={labelId}
          spacing={1}
          value={value}
          onValueChange={(next) => {
            if (next) onChange(next); // pressing the chosen item must not leave none
          }}
          className="w-max p-2 sm:w-full sm:flex-col sm:items-stretch"
        >
          {options.map((option) => (
            <ToggleGroupItem
              key={option.value}
              ref={option.value === value ? chosen : undefined}
              value={option.value}
              // Radios choose as the arrow keys reach them; Radix only moves the focus.
              onFocus={() => {
                if (option.value !== value) onChange(option.value);
              }}
              className="font-normal data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ScrollBar orientation="horizontal" className="sm:hidden" />
      </ScrollArea>
    </div>
  );
}

/**
 * Memoised because it is most of the cost of a render, and every tap on an hour or minute (every
 * arrow key too) would otherwise repeat it for a day that hasn't changed.
 */
const DayCalendar = memo(function DayCalendar({
  date,
  minDate,
  maxDate,
  onChange,
}: Pick<DateTimePickerProps, 'minDate' | 'maxDate' | 'onChange'> & { date: string }) {
  const t = useTranslations('SearchForm');
  const format = useFormatter();
  const locale = useLocale();
  const timeZone = useTimeZone();

  const min = atNoon(minDate);
  const max = atNoon(maxDate);
  const day = atNoon(date);
  const selected = Number.isNaN(day.getTime()) ? undefined : day;
  const monthName = (month: Date) => format.dateTime(month, { month: 'long', year: 'numeric' });

  return (
    <Calendar
      mode="single"
      required
      autoFocus
      lang={locale} // the library says en-US otherwise, around Greek text
      className="mx-auto"
      timeZone={timeZone}
      // As OpeningHours does, and as Greek calendars do.
      weekStartsOn={1}
      selected={selected}
      defaultMonth={selected ?? min}
      startMonth={min}
      endMonth={max}
      disabled={{ before: min, after: max }}
      onSelect={(pressed) =>
        // en-CA formats as YYYY-MM-DD; the zone keeps it the Athens day the visitor pressed.
        onChange({ date: new Intl.DateTimeFormat('en-CA', { timeZone }).format(pressed) })
      }
      formatters={{
        formatCaption: monthName,
        formatWeekdayName: (weekday) => format.dateTime(weekday, { weekday: 'short' }),
      }}
      // The library's own labels are English whatever the page language.
      labels={{
        labelDayButton: (labelled, modifiers) => {
          const name = format.dateTime(labelled, { dateStyle: 'full' });
          const named = modifiers.today ? t('today', { date: name }) : name;
          return modifiers.selected ? t('selectedDay', { date: named }) : named;
        },
        labelGrid: monthName,
        labelNav: () => t('monthNavigation'),
        labelNext: () => t('nextMonth'),
        labelPrevious: () => t('previousMonth'),
        labelWeekday: (weekday) => format.dateTime(weekday, { weekday: 'long' }),
      }}
    />
  );
});

/**
 * Day on the left, hour and half hour on the right. Loaded by `DateTimeField` once someone heads
 * for it, because the calendar and the overlay would otherwise reach every first visit.
 */
export function DateTimePicker({
  id,
  anchor,
  labelledBy,
  open,
  onOpenChange,
  onClosed,
  value,
  onChange,
  minDate,
  maxDate,
  times,
}: DateTimePickerProps) {
  const t = useTranslations('SearchForm');
  const format = useFormatter();
  const locale = useLocale();
  const leftByClickingAway = useRef(false);

  const [hour = '', minute = ''] = value.time.split(':');
  const hours = [...new Set(times.map((time) => time.slice(0, 2)))];
  const minutes = [...new Set(times.map((time) => time.slice(3)))];
  const hourLabel = (option: string) =>
    format.dateTime(new Date(Date.UTC(2000, 0, 1, Number(option))), {
      ...hourOptions(locale),
      timeZone: 'UTC',
    });

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchor as RefObject<HTMLButtonElement>} />
      <PopoverContent
        id={id}
        aria-labelledby={labelledBy}
        align="start"
        collisionPadding={16} // the page's gutter, on phones
        className="flex max-h-(--radix-popover-content-available-height) w-auto max-w-[calc(100vw-2rem)] flex-col overflow-y-auto p-0 sm:flex-row"
        // The calendar focuses the chosen day itself.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!leftByClickingAway.current) anchor.current?.focus();
          leftByClickingAway.current = false;
          onClosed();
        }}
        onInteractOutside={(event) => {
          // A press on the field toggles it; closing here too would open it again.
          if (anchor.current?.contains(event.target as Node)) event.preventDefault();
          else leftByClickingAway.current = true;
        }}
      >
        <DayCalendar date={value.date} minDate={minDate} maxDate={maxDate} onChange={onChange} />
        <div className="flex min-w-0 flex-col divide-y border-t sm:h-[19rem] sm:flex-row sm:divide-x sm:divide-y-0 sm:border-t-0 sm:border-l">
          <TimeColumn
            label={t('hour')}
            value={hour}
            options={hours.map((option) => ({ value: option, label: hourLabel(option) }))}
            onChange={(next) => onChange({ time: `${next}:${minute}` })}
          />
          <TimeColumn
            label={t('minutes')}
            value={minute}
            options={minutes.map((option) => ({ value: option, label: option }))}
            onChange={(next) => onChange({ time: `${hour}:${next}` })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
