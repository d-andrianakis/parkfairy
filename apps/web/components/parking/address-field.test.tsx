import { getPlaceSuggestions, retrievePlace } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';
import { AddressField, SUGGEST_DELAY_MS, type AddressFieldProps } from './address-field';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  getPlaceSuggestions: vi.fn(),
  retrievePlace: vi.fn(),
}));
const suggest = vi.mocked(getPlaceSuggestions);
const retrieve = vi.mocked(retrievePlace);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.searchForm);

const SUGGESTIONS = [
  { id: 'dXJuOm1ieGFkcg', name: 'Ermou 10', detail: '105 63 Athens' },
  { id: 'dXJuOm1ieHBsYw', name: 'Ermou Street', detail: 'Athens' },
];
const PLACE = { label: 'Ermou 10, 105 63 Athens, Greece', latitude: 37.97654, longitude: 23.73321 };

/** The field as the search form has it: an area list and the position's hidden fields. */
function show(props: Partial<AddressFieldProps> = {}, locale: 'en' | 'el' = 'en') {
  const view = renderInSubtree(
    <form aria-label="search">
      <select name="area" aria-label="Where" defaultValue="">
        <option value="">My location</option>
        <option value="koukaki">Koukaki</option>
      </select>
      <input type="hidden" name="latitude" defaultValue="" />
      <input type="hidden" name="longitude" defaultValue="" />
      <input type="hidden" name="placeLocale" defaultValue="" />
      <label htmlFor="search-place">{locale === 'el' ? 'Διεύθυνση' : 'Address'}</label>
      <AddressField
        id="search-place"
        defaultValue=""
        latitude=""
        longitude=""
        placeLocale=""
        describedBy="search-place-hint"
        {...props}
      />
      <p id="search-place-hint">Hint</p>
      <button type="submit">Search</button>
    </form>,
    { locale },
  );
  const form = view.container.querySelector('form') as HTMLFormElement;
  const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
  return { ...view, form, value };
}
const field = () => screen.getByRole('combobox', { name: /^(Address|Διεύθυνση)$/ });

beforeEach(() => {
  vi.clearAllMocks();
  suggest.mockResolvedValue(answer({ suggestions: SUGGESTIONS }) as never);
  retrieve.mockResolvedValue(answer(PLACE) as never);
});

describe('AddressField', () => {
  it('suggests places once typing pauses, as a combobox with a list', async () => {
    const { container } = show();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(field()).toHaveAccessibleName('Address');
    await userEvent.type(field(), 'Ermou');
    const list = await screen.findByRole('listbox', { name: 'Address suggestions' });
    // One request for the word, not one per letter.
    expect(suggest).toHaveBeenCalledOnce();
    const [options] = suggest.mock.calls[0] as [{ query: Record<string, string> }];
    expect(options.query).toMatchObject({ q: 'Ermou', locale: 'en' });
    expect(options.query.session).toMatch(/^[0-9a-f-]{36}$/);
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(field()).toHaveAttribute('aria-controls', list.id);
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Ermou 10105 63 Athens', 'Ermou StreetAthens']);
    await waitFor(() =>
      expect(screen.getByText('2 suggestions below the field.')).toBeInTheDocument(),
    );
    await expectNoAxeViolations(container);
  });

  it('marks a Greek name Mapbox had no English for as Greek', async () => {
    suggest.mockResolvedValue(
      answer({
        suggestions: [
          { id: 'dXJuOm1ieGFkcg', name: 'Οδός Ερμού 10', detail: '105 63 Athens' },
          { id: 'dXJuOm1ieHBsYw', name: 'Ermou Street', detail: 'Αθήνα 105 63' },
        ],
      }) as never,
    );
    const { container } = show();
    await userEvent.type(field(), 'Ermou');
    const list = await screen.findByRole('listbox', { name: 'Address suggestions' });
    const [option] = within(list).getAllByRole('option');
    expect(option?.querySelector('[lang="el"]')).toHaveTextContent(/^Οδός Ερμού$/);
    // The number and "105 63 Athens" stay with the page.
    expect(option?.querySelectorAll('[lang]')).toHaveLength(1);
    // The detail too.
    const second = within(list).getAllByRole('option')[1];
    expect(second?.querySelector('[lang="el"]')).toHaveTextContent(/^Αθήνα$/);
    await expectNoAxeViolations(container);
  });

  it('marks nothing on a Greek page, where Greek words are the page’s own', async () => {
    suggest.mockResolvedValue(
      answer({
        suggestions: [{ id: 'dXJuOm1ieGFkcg', name: 'Οδός Ερμού 10', detail: 'Αθήνα' }],
      }) as never,
    );
    show({}, 'el');
    await userEvent.type(field(), 'Ερμού');
    const list = await screen.findByRole('listbox', { name: 'Προτάσεις διευθύνσεων' });
    expect(list.querySelectorAll('[lang]')).toHaveLength(0);
  });

  it('marks the field with the language its place was named in, until the words change', async () => {
    show(
      {
        defaultValue: 'Syntagma Square',
        latitude: '37.9755',
        longitude: '23.7348',
        placeLocale: 'en',
      },
      'el',
    );
    expect(field()).toHaveAttribute('lang', 'en');
    await userEvent.type(field(), 'x');
    expect(field()).not.toHaveAttribute('lang');
  });

  it('waits for a few letters before asking', () => {
    vi.useFakeTimers();
    try {
      show();
      fireEvent.change(field(), { target: { value: 'Er' } });
      vi.advanceTimersByTime(SUGGEST_DELAY_MS * 2);
      expect(suggest).not.toHaveBeenCalled();
      fireEvent.change(field(), { target: { value: 'Erm' } });
      vi.advanceTimersByTime(SUGGEST_DELAY_MS);
    } finally {
      vi.useRealTimers();
    }
    return waitFor(() => expect(suggest).toHaveBeenCalledOnce());
  });

  it('shows the suggestions for what is typed now, not an answer that came late', async () => {
    let late: (value: unknown) => void = () => undefined;
    suggest.mockImplementationOnce(() => new Promise((resolve) => (late = resolve)) as never);
    suggest.mockResolvedValueOnce(
      answer({
        suggestions: [{ id: 'dXJuOm1ieHBsYw', name: 'Syntagma', detail: 'Athens' }],
      }) as never,
    );
    show();
    await userEvent.type(field(), 'Ermou');
    await waitFor(() => expect(suggest).toHaveBeenCalledOnce());
    await userEvent.clear(field());
    await userEvent.type(field(), 'Syntagma');
    const list = await screen.findByRole('listbox');
    late(answer({ suggestions: SUGGESTIONS }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['SyntagmaAthens']);
  });

  it('keeps the list when a tap moves the focus into it, and takes the focus back', async () => {
    show();
    await userEvent.type(field(), 'Ermou');
    const list = await screen.findByRole('listbox');
    fireEvent.blur(field(), { relatedTarget: list });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(field()).toHaveFocus();
    // Anywhere else, it goes.
    fireEvent.blur(field(), { relatedTarget: document.body });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('follows the field in the reading order, not the end of the page', async () => {
    show();
    await userEvent.type(field(), 'Ermou');
    const list = await screen.findByRole('listbox');
    expect(field().compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.closest('form')).not.toBeNull();
  });

  it('moves with the arrows and picks with Enter, keeping the focus and not submitting', async () => {
    const submitted = vi.fn((event: Event) => event.preventDefault());
    const { form, value } = show();
    form.addEventListener('submit', submitted);
    await userEvent.type(field(), 'Ermou');
    const list = await screen.findByRole('listbox');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    const [first] = within(list).getAllByRole('option');
    expect(field()).toHaveAttribute('aria-activedescendant', first?.id);
    expect(first).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(field()).toHaveValue(PLACE.label));
    expect(field()).toHaveFocus();
    expect(submitted).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    // In the same session as its suggestions: that is what Mapbox bills once.
    const session = (suggest.mock.calls[0]?.[0] as { query: { session: string } }).query.session;
    expect(retrieve).toHaveBeenCalledWith({
      query: { id: SUGGESTIONS[0]?.id, session, locale: 'en' },
    });
    expect(value('latitude')).toBe(String(PLACE.latitude));
    expect(value('longitude')).toBe(String(PLACE.longitude));
    // Named by Mapbox in the page's language: the title marks it so after a language switch.
    expect(value('placeLocale')).toBe('en');
    await waitFor(() => expect(screen.getByText(`Chosen: ${PLACE.label}`)).toBeInTheDocument());
  });

  it('picks with a press too, and starts a new session after', async () => {
    show();
    await userEvent.type(field(), 'Ermou');
    await userEvent.click(await screen.findByRole('option', { name: /Ermou Street/ }));
    await waitFor(() => expect(field()).toHaveValue(PLACE.label));
    expect(field()).toHaveFocus();
    await userEvent.clear(field());
    await userEvent.type(field(), 'Syntagma');
    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(2));
    const sessions = suggest.mock.calls.map(
      (call) => (call[0] as { query: { session: string } }).query.session,
    );
    expect(sessions[1]).not.toBe(sessions[0]);
  });

  it('drops the position when the words change, and an area when a place is typed', async () => {
    const { form, value } = show();
    await userEvent.type(field(), 'Ermou');
    await userEvent.click(await screen.findByRole('option', { name: /Ermou 10/ }));
    await waitFor(() => expect(value('latitude')).not.toBe(''));
    (form.elements.namedItem('area') as HTMLSelectElement).value = 'koukaki';
    await userEvent.type(field(), 'x');
    expect(value('latitude')).toBe('');
    expect(value('longitude')).toBe('');
    expect(value('placeLocale')).toBe('');
    expect(value('area')).toBe('');
    // The shared position is gone too, so the area list no longer offers "My location".
    expect(screen.getByRole('option', { name: 'Choose an area' })).toHaveValue('');
  });

  it('empties itself when an area is chosen, so the form gives one answer to "where"', async () => {
    const { value } = show({ defaultValue: 'Ermou 10', latitude: '37.9', longitude: '23.7' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Where' }), 'koukaki');
    expect(screen.getByRole('combobox', { name: 'Address' })).toHaveValue('');
    expect(value('latitude')).toBe('');
  });

  it("puts a place's position back after hydration, as the server leaves it out", () => {
    const { value } = show({ defaultValue: 'Ermou 10', latitude: '37.9', longitude: '23.7' });
    expect(field()).toHaveValue('Ermou 10');
    expect(value('latitude')).toBe('37.9');
    expect(value('longitude')).toBe('23.7');
  });

  it('says so, in view and with the field, when nothing is found or search is down', async () => {
    suggest.mockResolvedValue(answer({ suggestions: [] }) as never);
    show();
    await userEvent.type(field(), 'Xyzzy');
    const none = await screen.findByText(/No addresses found/);
    expect(field()).toHaveAccessibleDescription(/No addresses found/);
    expect(none).toBeVisible();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    suggest.mockResolvedValue(refusal('PLACES_UNAVAILABLE', 503) as never);
    await userEvent.type(field(), 'z');
    expect(await screen.findByText(/Address search isn’t available right now/)).toBeVisible();
  });

  it('says when a pick has no position, and leaves it to the server', async () => {
    retrieve.mockResolvedValue(refusal('PLACE_NOT_FOUND', 404) as never);
    const { value } = show();
    await userEvent.type(field(), 'Ermou');
    await userEvent.click(await screen.findByRole('option', { name: /Ermou 10/ }));
    expect(await screen.findByText(/Press “Search” to look it up again/)).toBeVisible();
    expect(field()).toHaveValue('Ermou 10, 105 63 Athens');
    expect(value('latitude')).toBe('');
  });

  it('closes on Escape and keeps what was typed', async () => {
    show();
    await userEvent.type(field(), 'Ermou');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveValue('Ermou');
  });

  it('makes Search wait for a picked place’s position', async () => {
    let settle: (value: unknown) => void = () => undefined;
    retrieve.mockReturnValue(new Promise((resolve) => (settle = resolve)) as never);
    const positions: string[] = [];
    const { form, value } = show();
    await userEvent.type(field(), 'Ermou');
    await userEvent.click(await screen.findByRole('option', { name: /Ermou 10/ }));
    form.addEventListener('submit', (event) => {
      if (!event.defaultPrevented) positions.push(value('latitude'));
      event.preventDefault();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(positions).toEqual([]);
    settle(answer(PLACE));
    await waitFor(() => expect(positions).toEqual([String(PLACE.latitude)]));
  });

  it('speaks Greek', async () => {
    show({}, 'el');
    await userEvent.type(field(), 'Ερμού');
    await screen.findByRole('listbox', { name: 'Προτάσεις διευθύνσεων' });
    expect((suggest.mock.calls[0]?.[0] as { query: { locale: string } }).query.locale).toBe('el');
    await waitFor(() =>
      expect(screen.getByText('2 προτάσεις κάτω από το πεδίο.')).toBeInTheDocument(),
    );
  });
});
