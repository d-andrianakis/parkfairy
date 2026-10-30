import type { OpeningPeriod } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { OpeningHours } from './opening-hours';

const days = (opens: string, closes: string, list = [1, 2, 3, 4, 5]): OpeningPeriod[] =>
  list.map((weekday) => ({ weekday, opens, closes }));

/** What a day's cell says: "Closed", or one entry per opening period. */
const periodsOf = (name: RegExp) => {
  const cell = screen.getByRole('row', { name }).querySelector('td') as HTMLElement;
  const items = within(cell).queryAllByRole('listitem');
  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ').trim();
  return items.length > 0 ? items.map(text) : [text(cell)];
};

describe('OpeningHours', () => {
  it('lists the week from Monday, with closed days and split hours', async () => {
    const { container } = renderWithProviders(
      <OpeningHours
        periods={[
          ...days('07:30', '23:00'),
          { weekday: 6, opens: '08:00', closes: '13:00' },
          { weekday: 6, opens: '17:00', closes: '21:00' },
        ]}
      />,
    );
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    // The dash is hidden from screen readers, which hear "to" instead.
    expect(periodsOf(/Monday/)).toEqual(['7:30 AM– to 11:00 PM']);
    expect(periodsOf(/Saturday/)).toEqual(['8:00 AM– to 1:00 PM', '5:00 PM– to 9:00 PM']);
    expect(periodsOf(/Sunday/)).toEqual(['Closed']);
    await expectNoAxeViolations(container);
  });

  it('uses the 24-hour clock in Greek, with 24:00 for closing at midnight', () => {
    renderWithProviders(
      <OpeningHours
        periods={[
          ...days('00:00', '24:00', [1]),
          // Overnight: open until 02:00, again from 06:00 until midnight.
          ...days('00:00', '02:00', [2]),
          ...days('06:00', '24:00', [2]),
        ]}
      />,
      { locale: 'el' },
    );
    expect(periodsOf(/Δευτέρα/)).toEqual(['Ανοιχτά όλο το 24ωρο']);
    expect(periodsOf(/Τρίτη/)).toEqual(['00:00– έως 02:00', '06:00– έως 24:00']);
    expect(periodsOf(/Κυριακή/)).toEqual(['Κλειστά']);
  });
});
