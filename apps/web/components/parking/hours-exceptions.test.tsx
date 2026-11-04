import type { HoursException } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { HoursExceptions } from './hours-exceptions';

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim();
const rows = () =>
  screen
    .getAllByRole('row')
    .map((row) => [text(row.querySelector('th')), text(row.querySelector('td'))]);

/** As on the listing page: the table is named by the heading above it. */
function show(exceptions: HoursException[], locale: 'el' | 'en' = 'en') {
  return renderWithProviders(
    <>
      <h3 id="exceptions-heading">{locale === 'el' ? 'Κλειστές ημέρες' : 'Closures'}</h3>
      <HoursExceptions exceptions={exceptions} today="2027-11-03" labelledBy="exceptions-heading" />
    </>,
    { locale },
  );
}

const christmas: HoursException[] = [
  {
    startsOn: '2027-12-24',
    endsOn: '2027-12-24',
    hours: { opens: '08:00', closes: '14:00' },
    closedHours: null,
  },
  { startsOn: '2027-12-25', endsOn: '2027-12-26', hours: null, closedHours: null },
  {
    startsOn: '2027-12-31',
    endsOn: '2027-12-31',
    hours: { opens: '18:00', closes: '24:00' },
    closedHours: null,
  },
];

describe('HoursExceptions', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    process.env.TZ = zone;
  });

  it('names each day or range, with “to” for listeners where the dash is', async () => {
    const { container } = show(christmas);
    expect(rows()).toEqual([
      ['Friday, December 24', '8:00 AM– to 2:00 PM'],
      ['Saturday, December 25 – to Sunday, December 26', 'Closed'],
      ['Friday, December 31', '6:00 PM– to 12:00 AM'],
    ]);
    // Named once, by its heading, rather than by a caption repeating it.
    expect(screen.getByRole('table', { name: 'Closures' })).toBeInTheDocument();
    expect(container.querySelector('caption')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('marks each day up as a date', () => {
    const { container } = show(christmas);
    expect([...container.querySelectorAll('time')].map((time) => time.dateTime)).toEqual([
      '2027-12-24',
      '2027-12-25',
      '2027-12-26',
      '2027-12-31',
    ]);
  });

  it('says when a day is closed for part of it, in words rather than a dash', () => {
    const part: HoursException[] = [
      {
        startsOn: '2027-12-02',
        endsOn: '2027-12-02',
        hours: null,
        closedHours: { from: '10:00', to: '14:00' },
      },
    ];
    const { unmount } = show(part);
    expect(rows()).toEqual([['Thursday, December 2', 'Closed from 10:00 AM to 2:00 PM']]);
    unmount();
    show(part, 'el');
    expect(rows()).toEqual([['Πέμπτη 2 Δεκεμβρίου', 'Κλειστά από 10:00 έως 14:00']]);
  });

  it('names the year when it isn’t this one', () => {
    show([
      { startsOn: '2027-12-31', endsOn: '2028-01-01', hours: null, closedHours: null },
      { startsOn: '2028-01-06', endsOn: '2028-01-06', hours: null, closedHours: null },
    ]);
    const heads = rows().map(([head]) => head);
    expect(heads[0]).toMatch(/2027.*to.*2028/);
    expect(heads[1]).toContain('2028');
  });

  it('keeps the calendar day where noon UTC is already tomorrow', () => {
    // UTC+14: a date formatted in the machine's zone would move to the next day.
    process.env.TZ = 'Pacific/Kiritimati';
    show([{ startsOn: '2027-12-24', endsOn: '2027-12-24', hours: null, closedHours: null }]);
    expect(rows()).toEqual([['Friday, December 24', 'Closed']]);
  });

  it('reads in Greek, with 24:00 at midnight', () => {
    show(christmas, 'el');
    expect(rows()).toEqual([
      ['Παρασκευή 24 Δεκεμβρίου', '08:00– έως 14:00'],
      ['Σάββατο 25 Δεκεμβρίου – έως Κυριακή 26 Δεκεμβρίου', 'Κλειστά'],
      ['Παρασκευή 31 Δεκεμβρίου', '18:00– έως 24:00'],
    ]);
  });
});
