import { DEFAULT_TIME_ZONE } from '@parkfairy/contracts/locales';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPathname } from '@/i18n/navigation';
import type { SearchValues } from '@/lib/search';
import { catalogs, renderWithProviders } from '@/test/render';

import { SearchForm } from './search-form';

const byId = (id: string) => document.getElementById(id) as HTMLElement;

const values: SearchValues = {
  area: 'koukaki',
  place: '',
  placeLocale: '',
  latitude: '',
  longitude: '',
  startDate: '2026-11-02',
  startTime: '09:00',
  endDate: '2026-11-02',
  endTime: '17:30',
  features: [],
  security: [],
  vehicleHeight: '',
  vehicleLength: '',
  vehicleWidth: '',
};

describe('SearchForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a labelled GET form to the localized search page', async () => {
    vi.mocked(getPathname).mockReturnValue('/el/search');
    const { container } = renderWithProviders(<SearchForm values={values} minDate="2026-10-29" />, {
      locale: 'el',
    });

    const form = screen.getByRole('search', { name: 'Αναζήτηση στάθμευσης' });
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/el/search');
    // The server explains problems in the page language; no untranslated browser bubbles.
    expect(form).toHaveAttribute('novalidate');
    expect(screen.getByRole('combobox', { name: 'Πού' })).toHaveValue('koukaki');
    expect(screen.getByRole('button', { name: 'Χρήση τοποθεσίας' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  describe('filters (5A.1)', () => {
    const filtered: SearchValues = {
      ...values,
      features: ['covered'],
      security: ['cctv', 'gated'],
      vehicleHeight: '190',
      vehicleLength: '',
      vehicleWidth: '210',
    };

    it('offers each feature and security box as a native checkbox, so a plain form submit keeps them', () => {
      renderWithProviders(<SearchForm values={filtered} minDate="2026-10-29" />);
      const group = screen.getByRole('group', { name: 'Filters' });
      const covered = within(group).getByRole('checkbox', { name: 'Covered' });
      expect(covered).toBeChecked();
      expect(covered).toHaveAttribute('name', 'features');
      expect(covered).toHaveAttribute('value', 'covered');
      expect(covered.tagName).toBe('INPUT');
      expect(within(group).getByRole('checkbox', { name: 'EV charging' })).not.toBeChecked();
      const cctv = within(group).getByRole('checkbox', { name: 'CCTV' });
      expect(cctv).toBeChecked();
      expect(cctv).toHaveAttribute('name', 'security');
      expect(within(group).getByRole('checkbox', { name: 'Gated entry' })).toBeChecked();
      expect(within(group).getByRole('checkbox', { name: 'Lit at night' })).not.toBeChecked();
    });

    it('groups them by what they describe, in Greek too', () => {
      renderWithProviders(<SearchForm values={filtered} minDate="2026-10-29" />, { locale: 'el' });
      expect(screen.getByRole('group', { name: 'Φίλτρα' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Παροχές θέσης' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Ασφάλεια' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Κάμερες ασφαλείας' })).toBeChecked();
    });

    it('asks for the vehicle’s size in centimetres, keeps what was typed, and says what is left out', () => {
      renderWithProviders(<SearchForm values={filtered} minDate="2026-10-29" />);
      const height = screen.getByLabelText('Height (cm)');
      expect(height).toHaveValue('190');
      expect(height).toHaveAttribute('name', 'vehicleHeightCm');
      expect(screen.getByLabelText('Length (cm)')).toHaveValue('');
      expect(screen.getByLabelText('Width (cm)')).toHaveAttribute('name', 'vehicleWidthCm');
    });

    it('explains a size with its limits beside that field only, and marks only that field', () => {
      renderWithProviders(
        <SearchForm
          values={{ ...filtered, vehicleHeight: '190', vehicleLength: '99', vehicleWidth: '210' }}
          errors={{ vehicleLength: 'sizeLengthInvalid' }}
          minDate="2026-10-29"
        />,
      );
      const length = screen.getByLabelText('Length (cm)');
      expect(length).toHaveAttribute('aria-invalid', 'true');
      expect(length).toHaveAccessibleDescription('Enter a length from 200 to 1500 cm');
      expect(length.id).toBe('search-vehicle-length');
      // The sizes that are fine are not said to be wrong, nor read the error.
      for (const name of ['Height (cm)', 'Width (cm)']) {
        const field = screen.getByLabelText(name);
        expect(field).not.toHaveAttribute('aria-invalid');
        expect(field).not.toHaveAttribute('aria-describedby');
      }
    });

    it('says each size’s limits in Greek too', () => {
      renderWithProviders(
        <SearchForm
          values={{ ...filtered, vehicleHeight: '99' }}
          errors={{ vehicleHeight: 'sizeHeightInvalid' }}
          minDate="2026-10-29"
        />,
        { locale: 'el' },
      );
      expect(screen.getByLabelText('Ύψος (εκ.)')).toHaveAccessibleDescription(
        'Εισαγάγετε ύψος από 100 έως 500 εκ.',
      );
    });

    it('reads the hint once, for the group of sizes, not after each field', () => {
      renderWithProviders(<SearchForm values={filtered} minDate="2026-10-29" />);
      expect(screen.getByRole('group', { name: 'Your vehicle' })).toHaveAccessibleDescription(
        expect.stringContaining('A space with no stated limit stays'),
      );
      for (const name of ['Height (cm)', 'Length (cm)', 'Width (cm)']) {
        expect(screen.getByLabelText(name)).not.toHaveAttribute('aria-describedby');
      }
    });

    it('gives each checkbox a row of at least 24 px (WCAG 2.5.8)', () => {
      renderWithProviders(<SearchForm values={filtered} minDate="2026-10-29" />);
      const row = screen.getByRole('checkbox', { name: 'CCTV' }).parentElement;
      expect(row).toHaveClass('min-h-6');
    });

    it('works before any script has run, as the rest of the form does', () => {
      const html = renderToString(
        <NextIntlClientProvider locale="en" messages={catalogs.en}>
          <SearchForm values={filtered} minDate="2026-10-29" />
        </NextIntlClientProvider>,
      );
      expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="features"[^>]*checked/);
      expect(html).toContain('name="vehicleHeightCm"');
    });

    it('is axe clean, with an error and without', async () => {
      const { container, rerender } = renderWithProviders(
        <SearchForm values={filtered} minDate="2026-10-29" />,
      );
      await expectNoAxeViolations(container);
      rerender(
        <SearchForm
          values={{ ...filtered, vehicleHeight: '99' }}
          errors={{ vehicleHeight: 'sizeHeightInvalid' }}
          minDate="2026-10-29"
        />,
      );
      await expectNoAxeViolations(container);
    });
  });

  describe('the address field (decision #40)', () => {
    const placed = {
      ...values,
      area: '',
      place: 'Ermou 10',
      latitude: '37.97',
      longitude: '23.73',
    };

    it('is offered only where address search is set up', () => {
      const { unmount } = renderWithProviders(<SearchForm values={values} minDate="2026-10-29" />);
      expect(screen.queryByRole('combobox', { name: 'Or type an address or place' })).toBeNull();
      unmount();
      renderWithProviders(<SearchForm values={values} minDate="2026-10-29" addressSearch />);
      const field = screen.getByRole('combobox', { name: 'Or type an address or place' });
      expect(field).toHaveAttribute('name', 'place');
      expect(field).toHaveAccessibleDescription(
        'Type a few letters, then choose from the list. A place you choose replaces the area. Suggestions by Mapbox.',
      );
    });

    it('renders a place’s position empty, for the field to put back once it runs', () => {
      // On the server, before any script: what a browser without JavaScript would send.
      const html = renderToString(
        <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone={DEFAULT_TIME_ZONE}>
          <SearchForm values={placed} minDate="2026-10-29" addressSearch />
        </NextIntlClientProvider>,
      );
      expect(html).toContain('value="Ermou 10"');
      expect(html).not.toContain('value="37.97"');
      // Without the field, the position stays with the place it came with.
      const without = renderToString(
        <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone={DEFAULT_TIME_ZONE}>
          <SearchForm values={placed} minDate="2026-10-29" />
        </NextIntlClientProvider>,
      );
      expect(without).toContain('value="37.97"');
    });

    it('shows its own error, tied to it, and says "choose an area" rather than "my location"', async () => {
      const { container } = renderWithProviders(
        <SearchForm
          values={{ ...placed, latitude: '', longitude: '' }}
          errors={{ place: 'placeNotFound' }}
          minDate="2026-10-29"
          addressSearch
        />,
      );
      const field = screen.getByRole('combobox', { name: 'Or type an address or place' });
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAccessibleDescription(/We couldn’t find that address/);
      expect(screen.getByRole('option', { name: 'Choose an area' })).toBeInTheDocument();
      await expectNoAxeViolations(container);
    });
  });

  it('groups areas by city, named in the page language', () => {
    renderWithProviders(<SearchForm values={values} minDate="2026-10-29" />, { locale: 'el' });
    const where = screen.getByRole('combobox', { name: 'Πού' });
    const athens = within(where).getByRole('group', { name: 'Αθήνα' });
    expect(within(athens).getByRole('option', { name: 'Λιμάνι Πειραιά' })).toHaveValue(
      'piraeusPort',
    );
    expect(within(where).getByRole('group', { name: 'Θεσσαλονίκη' })).toBeInTheDocument();
  });

  it('asks for one date and time for each end of the stay', () => {
    renderWithProviders(<SearchForm values={values} minDate="2026-10-29" />);

    const startField = byId('search-start-date');
    expect(screen.getByRole('group', { name: 'From' })).toContainElement(startField);
    expect(startField).toHaveAccessibleName('From');
    expect(startField).toHaveTextContent(/Mon, Nov 2.*9:00 AM/);
    const endField = byId('search-end-date');
    expect(screen.getByRole('group', { name: 'Until' })).toContainElement(endField);
    expect(endField).toHaveAccessibleName('Until');
    expect(endField).toHaveTextContent(/Mon, Nov 2.*5:30 PM/);

    // The URL keeps its four fields: shared searches and the server's validation depend on them.
    const form = screen.getByRole<HTMLFormElement>('search');
    expect(Object.fromEntries(new FormData(form))).toMatchObject({
      startDate: '2026-11-02',
      startTime: '09:00',
      endDate: '2026-11-02',
      endTime: '17:30',
    });
  });

  it('works without JavaScript, up to the 365-day horizon', () => {
    const host = document.body.appendChild(document.createElement('div'));
    host.innerHTML = renderToString(
      <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone={DEFAULT_TIME_ZONE}>
        <SearchForm values={values} minDate="2026-10-29" />
      </NextIntlClientProvider>,
    );

    const startDate = byId('search-start-date');
    expect(startDate).toHaveAttribute('type', 'date');
    expect(startDate).toHaveAttribute('min', '2026-10-29');
    expect(startDate).toHaveAttribute('max', '2027-10-29');
    // The last stay can start on that day and run for 30 more.
    expect(byId('search-end-date')).toHaveAttribute('max', '2027-11-28');
    const endTime = within(host).getByRole('combobox', { name: 'Until Time' });
    expect(endTime).toHaveValue('17:30');
    expect(within(endTime).getAllByRole('option')).toHaveLength(48);
    host.remove();
  });

  it('wires translated errors to the fields they belong to, without live regions', async () => {
    const { container } = renderWithProviders(
      <SearchForm
        values={{ ...values, area: '' }}
        errors={{ area: 'locationRequired', end: 'durationTooLong' }}
        minDate="2026-10-29"
      />,
      { locale: 'el' },
    );
    const where = screen.getByRole('combobox', { name: 'Πού' });
    expect(where).toHaveAttribute('aria-invalid', 'true');
    expect(where).toHaveAccessibleDescription(
      'Επιλέξτε περιοχή ή χρησιμοποιήστε την τοποθεσία σας',
    );
    const endField = byId('search-end-date');
    expect(screen.getByRole('group', { name: 'Έως' })).toContainElement(endField);
    expect(endField).toHaveAccessibleName('Έως');
    expect(endField).toHaveAttribute('aria-invalid', 'true');
    expect(endField).toHaveAccessibleDescription('Η στάθμευση μπορεί να διαρκεί έως 30 ημέρες');
    expect(byId('search-start-date')).not.toHaveAttribute('aria-invalid');
    // No live regions and no unnamed groups (the wrappers drop shadcn's default roles).
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('[data-slot=field][role=group]')).toHaveLength(0);
    await expectNoAxeViolations(container);
  });

  it('moves Until with From, because both fields share one stay', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    renderWithProviders(<SearchForm values={values} minDate="2026-10-29" />);

    await userEvent.click(byId('search-start-date'));
    const dialog = await screen.findByRole('dialog', { name: 'From' }, { timeout: 5000 });
    await userEvent.click(within(dialog).getByRole('radio', { name: '6 PM' }));

    const form = screen.getByRole<HTMLFormElement>('search');
    expect(Object.fromEntries(new FormData(form))).toMatchObject({
      startDate: '2026-11-02',
      startTime: '18:00',
      endDate: '2026-11-03',
      endTime: '02:30',
    });
  });

  it('says "my location" when searching near a shared position', () => {
    renderWithProviders(
      <SearchForm
        values={{ ...values, area: '', latitude: '37.976', longitude: '23.735' }}
        minDate="2026-10-29"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Where' })).toHaveDisplayValue('My location');
  });
});
