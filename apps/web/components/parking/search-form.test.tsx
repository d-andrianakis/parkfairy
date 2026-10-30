import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getPathname } from '@/i18n/navigation';
import type { SearchValues } from '@/lib/search';
import { renderWithProviders } from '@/test/render';
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

  it('asks for a date and a half-hour time for each end of the stay', () => {
    renderWithProviders(<SearchForm values={values} minDate="2026-10-29" />);
    const from = screen.getByRole('group', { name: 'From' });
    const until = screen.getByRole('group', { name: 'Until' });

    // Named by legend + label ("From Date"), so forms lists and rotors keep the context.
    const startDate = byId('search-start-date');
    expect(from).toContainElement(startDate);
    expect(startDate).toHaveAccessibleName('From Date');
    expect(startDate).toHaveAttribute('type', 'date');
    expect(startDate).toHaveAttribute('min', '2026-10-29');
    expect(startDate).toHaveAttribute('max', '2027-10-29'); // the 365-day horizon
    expect(startDate).toHaveValue('2026-11-02');
    const endTime = within(until).getByRole('combobox', { name: 'Until Time' });
    expect(endTime).toHaveValue('17:30');
    expect(within(endTime).getAllByRole('option')).toHaveLength(48);
    expect(within(endTime).getByRole('option', { name: '5:30 PM' })).toHaveValue('17:30');
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
    const endDate = byId('search-end-date');
    expect(screen.getByRole('group', { name: 'Έως' })).toContainElement(endDate);
    expect(endDate).toHaveAccessibleName('Έως Ημερομηνία');
    expect(endDate).toHaveAttribute('aria-invalid', 'true');
    expect(endDate).toHaveAccessibleDescription('Η στάθμευση μπορεί να διαρκεί έως 30 ημέρες');
    expect(byId('search-start-date')).not.toHaveAttribute('aria-invalid');
    // No live regions and no unnamed groups (the wrappers drop shadcn's default roles).
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('[data-slot=field][role=group]')).toHaveLength(0);
    await expectNoAxeViolations(container);
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
