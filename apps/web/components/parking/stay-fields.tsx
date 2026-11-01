'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_DURATION_MS } from '@/lib/search-params';
import type { DateTimeValue } from './date-time-picker';

export type StayPart = 'start' | 'end';

interface Stay {
  start?: DateTimeValue;
  end?: DateTimeValue;
  /** The stay when From's picker first changed it; goes when that picker closes. */
  before?: { start: DateTimeValue; end: DateTimeValue };
  /** Until moved the last time From's picker closed: the page says so. */
  moved?: boolean;
}

/** Past this, `toISOString` writes `+010000-…` or throws: Safari parses six-digit years. */
const LAST_WALL_CLOCK_MS = Date.UTC(9999, 11, 31, 23, 59);

/** On the Athens wall clock, which is what people pick: "two hours later" reads as such. */
const wallClockMs = ({ date, time }: DateTimeValue) => Date.parse(`${date}T${time}:00Z`);

/**
 * Where Until belongs for this start. Worked out from the stay before the picker changed it, not
 * from the last step: a day, an hour and an arrow key each change From, and every step on the
 * way would otherwise shorten the stay.
 */
function endFor(before: NonNullable<Stay['before']>, start: DateTimeValue): DateTimeValue {
  const from = wallClockMs(before.start);
  const until = wallClockMs(before.end);
  const next = wallClockMs(start);
  const moved = next + (until > from ? until - from : DEFAULT_DURATION_MS);
  // A date the URL mangled is for the server to explain. Written this way round to catch NaN.
  if (!(next >= until && moved <= LAST_WALL_CLOCK_MS)) return before.end;
  const end = new Date(moved).toISOString();
  return { date: end.slice(0, 10), time: end.slice(11, 16) };
}

function withChange(stay: Stay, part: StayPart, change: Partial<DateTimeValue>): Stay {
  const { start, end } = stay;
  const value = { date: '', time: '', ...stay[part], ...change };
  if (part === 'end' || !start || !end) return { ...stay, [part]: value, moved: false };
  const before = stay.before ?? { start, end };
  return { ...stay, start: value, end: endFor(before, value), before, moved: false };
}

function settled(stay: Stay): Stay {
  const { before, ...rest } = stay;
  return before ? { ...rest, moved: rest.end !== before.end } : stay;
}

interface StayContextValue {
  stay: Stay;
  set: (part: StayPart, change: Partial<DateTimeValue>) => void;
  /** From's picker is closed and the focus is back: nothing is in the middle of changing. */
  settle: () => void;
}

const StayContext = createContext<StayContextValue | null>(null);

/**
 * Holds both ends of the stay, so a From picked past Until takes Until along, keeping the length
 * of the stay. Without JavaScript the server explains the conflict instead.
 */
export function StayFields({ children }: { children: ReactNode }) {
  const [stay, setStay] = useState<Stay>({});
  const set = useCallback(
    (part: StayPart, change: Partial<DateTimeValue>) =>
      setStay((current) => withChange(current, part, change)),
    [],
  );
  const settle = useCallback(() => setStay(settled), []);
  const context = useMemo(() => ({ stay, set, settle }), [stay, set, settle]);

  return <StayContext.Provider value={context}>{children}</StayContext.Provider>;
}

export function useStay(): StayContextValue {
  const context = useContext(StayContext);
  if (!context) throw new Error('useStay needs StayFields around it');
  return context;
}
