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
  latitude: '',
  longitude: '',
  startDate: '2026-11-02',
  startTime: '09:00',
  endDate: '2026-11-02',
  endTime: '17:30',
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
