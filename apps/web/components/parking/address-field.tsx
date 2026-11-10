'use client';

import type { PlaceSuggestion } from '@parkfairy/api-client';
import { PLACE_QUERY_LIMITS } from '@parkfairy/contracts/validation';
import { Input } from '@parkfairy/ui/components/input';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { useAnnouncer } from '@/components/use-announcer';
import { optionId } from './place-option-id';

/** Long enough that a word typed at speed is one request, short enough to feel immediate. */
export const SUGGEST_DELAY_MS = 300;

const loadList = () => import('./place-suggestion-list');
const PlaceSuggestionList = dynamic(() => loadList().then((module) => module.PlaceSuggestionList), {
  ssr: false,
});
/**
 * The API client, only once the field is used: imported statically, its whole runtime and every
 * endpoint would reach each visitor of the home and search pages (about 4 KiB gzip).
 */
const loadApi = () => Promise.all([import('@parkfairy/api-client'), import('@/lib/api-call')]);
const preload = () => {
  void loadList();
  void loadApi();
};

/** A UUID for Mapbox's session; `randomUUID` needs a secure context, which a LAN test may not be. */
function newSession(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function field(form: HTMLFormElement | null | undefined, name: string) {
  const found = form?.elements.namedItem(name);
  return found instanceof HTMLInputElement || found instanceof HTMLSelectElement ? found : null;
}

export interface AddressFieldProps {
  id: string;
  /** The place in the URL: what was typed or picked last time. */
  defaultValue: string;
  /** Its position and language, when it has them; put back after hydration (see below). */
  latitude: string;
  longitude: string;
  placeLocale: string;
  /** Hint and error ids from the server-rendered field around it. */
  describedBy?: string;
  invalid?: boolean;
}

/**
 * An address or place, with suggestions as it is typed (decision #40): an ARIA 1.2 combobox. Each
 * few letters ask our API, which asks Mapbox; picking one asks for its position, which goes into the
 * form's `latitude`/`longitude` with the page's language (`placeLocale`, the language Mapbox named
 * it in), so Search sends coordinates and the place's words for the title. Text never picked is sent
 * without them, and the server looks it up once.
 *
 * The position is cleared by any edit, as it belongs to the words picked. For the same reason the
 * server renders the position fields empty when there is a place, and this puts them back after
 * hydration: without JavaScript, an edited place would otherwise travel with the old position.
 * Typing here lets go of a chosen area or a shared position, and choosing an area empties this, so
 * the form never sends two answers to "where" (the hint says so).
 */
export function AddressField({
  id,
  defaultValue,
  latitude,
  longitude,
  placeLocale,
  describedBy,
  invalid,
}: AddressFieldProps) {
  const t = useTranslations('SearchForm');
  const locale = useLocale() as 'el' | 'en';
  const listId = useId();
  const problemId = useId();
  const input = useRef<HTMLInputElement>(null);
  // Right after the field: the list renders there, in the reading order.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [problem, setProblem] = useState('');
  const { announce, region } = useAnnouncer();
  const session = useRef<string | null>(null);
  const latest = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const picking = useRef<Promise<void> | null>(null);

  function setPosition(position: { latitude: number; longitude: number } | null, lang = '') {
    const form = input.current?.form;
    const lat = field(form, 'latitude');
    const lng = field(form, 'longitude');
    const named = field(form, 'placeLocale');
    if (lat) lat.value = position ? String(position.latitude) : '';
    if (lng) lng.value = position ? String(position.longitude) : '';
    if (named) named.value = position ? lang : '';
  }

  function close() {
    setOpen(false);
    setActive(-1);
  }

  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    if (defaultValue && latitude && longitude && input.current?.value === defaultValue) {
      setPosition({ latitude: Number(latitude), longitude: Number(longitude) }, placeLocale);
    }
    const onChange = (event: Event) => {
      const target = event.target as HTMLSelectElement;
      if (target.name !== 'area' || target.value === '') return;
      setValue('');
      setProblem('');
      setPosition(null);
      close();
    };
    // A pick still finding its position: Search waits for it, then goes.
    const onSubmit = (event: SubmitEvent) => {
      const pending = picking.current;
      if (!pending) return;
      event.preventDefault();
      void pending.then(() => form.requestSubmit(event.submitter as HTMLElement | null));
    };
    form.addEventListener('change', onChange);
    form.addEventListener('submit', onSubmit);
    return () => {
      form.removeEventListener('change', onChange);
      form.removeEventListener('submit', onSubmit);
      window.clearTimeout(timer.current);
    };
    // Once, after hydration: the props are the URL's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function suggest(q: string) {
    const request = ++latest.current;
    session.current ??= newSession();
    const sessionId = session.current;
    const [{ getPlaceSuggestions }, { attempt }] = await loadApi();
    const outcome = await attempt(() =>
      getPlaceSuggestions({ query: { q, session: sessionId, locale } }),
    );
    if (request !== latest.current) return; // something newer was typed meanwhile
    if (!outcome.ok) {
      setSuggestions([]);
      close();
      setProblem(t('suggestionsUnavailable'));
      return;
    }
    const found = outcome.data.suggestions;
    setSuggestions(found);
    setActive(-1);
    setOpen(found.length > 0);
    setProblem(found.length > 0 ? '' : t('noSuggestions'));
    if (found.length > 0) announce(t('suggestionCount', { count: found.length }));
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const text = event.target.value;
    setValue(text);
    setProblem('');
    setPosition(null);
    const area = field(event.target.form, 'area');
    if (area instanceof HTMLSelectElement) {
      area.value = '';
      // It read "My location" for a shared position, which typing has just let go.
      const empty = area.options[0];
      if (empty && empty.value === '') empty.text = t('chooseArea');
    }
    window.clearTimeout(timer.current);
    latest.current += 1; // an answer on its way is about older words now
    const q = text.trim();
    if (q.length < PLACE_QUERY_LIMITS.min) {
      setSuggestions([]);
      close();
      return;
    }
    timer.current = window.setTimeout(() => void suggest(q), SUGGEST_DELAY_MS);
  }

  async function pick(index: number) {
    const choice = suggestions[index];
    const sessionId = session.current;
    if (!choice || !sessionId) return;
    // Its position ends the session Mapbox bills; the next words start another.
    session.current = null;
    latest.current += 1;
    setValue(choice.detail ? `${choice.name}, ${choice.detail}` : choice.name);
    setSuggestions([]);
    close();
    input.current?.focus();
    const run = (async () => {
      const [{ retrievePlace }, { attempt }] = await loadApi();
      const outcome = await attempt(() =>
        retrievePlace({ query: { id: choice.id, session: sessionId, locale } }),
      );
      if (outcome.ok) {
        setValue(outcome.data.label);
        setPosition(outcome.data, locale);
        announce(t('placeChosen', { place: outcome.data.label }));
      } else {
        setProblem(t('pickFailed'));
      }
    })();
    picking.current = run;
    await run;
    picking.current = null;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = suggestions.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (count === 0) return;
      event.preventDefault();
      setOpen(true);
      setActive((current) =>
        event.key === 'ArrowDown' ? (current + 1) % count : current <= 0 ? count - 1 : current - 1,
      );
    } else if (event.key === 'Enter' && open && active >= 0) {
      event.preventDefault(); // picks; Search is a press of its own
      void pick(active);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  }

  // A tap on the list's edge can move the focus into it (Radix makes it focusable): take the focus
  // back and keep the list, or the tap would close it before the pick lands.
  function onBlur(event: FocusEvent<HTMLInputElement>) {
    const list = document.getElementById(listId);
    if (list && event.relatedTarget instanceof Node && list.contains(event.relatedTarget)) {
      input.current?.focus();
      return;
    }
    close();
  }

  const described = [describedBy, problem ? problemId : undefined].filter(Boolean).join(' ');

  return (
    <>
      <Input
        ref={input}
        id={id}
        name="place"
        type="text"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        // The list's code before it is needed: the first suggestions shouldn't wait for it.
        onFocus={preload}
        onPointerEnter={preload}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(listId, active) : undefined}
        aria-describedby={described || undefined}
        aria-invalid={invalid}
        autoComplete="off"
        spellCheck={false}
        maxLength={PLACE_QUERY_LIMITS.max}
      />
      <div ref={setSlot} />
      {open ? (
        <PlaceSuggestionList
          anchor={input}
          container={slot}
          id={listId}
          label={t('suggestionsLabel')}
          suggestions={suggestions}
          active={active}
          onPick={(index) => void pick(index)}
          onActive={setActive}
          onDismiss={close}
        />
      ) : null}
      {region}
      {/* Always there, so each new message is read; visible, as it says what to do next. */}
      <p id={problemId} role="status" className="text-sm text-muted-foreground empty:sr-only">
        {problem}
      </p>
    </>
  );
}
