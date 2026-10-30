import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { StayRange } from './stay-range';

// 2 November 2026 is a Monday; Athens is UTC+2 in winter.
const START = '2026-11-02T07:00:00.000Z';
const SAME_DAY_END = '2026-11-02T09:30:00.000Z';
const NEXT_DAY_END = '2026-11-03T08:00:00.000Z';

function renderRange(end: string, locale: 'el' | 'en') {
  return renderWithProviders(
    <p data-testid="range">
      <StayRange start={START} end={end} />
    </p>,
    { locale },
  );
}

/** The text a screen reader gets: aria-hidden parts removed, whitespace collapsed. */
function spoken(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden]').forEach((node) => node.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('StayRange', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads "to" instead of the dash, in Athens time (Greek, 24-hour)', () => {
    renderRange(SAME_DAY_END, 'el');
    const range = screen.getByTestId('range');
    expect(spoken(range)).toBe('Δευ 2 Νοε, 09:00 έως 11:30');
    const dash = range.querySelector('[aria-hidden]');
    expect(dash?.textContent?.trim()).toMatch(/^[–-]$/);
    expect(screen.getByText('έως')).toHaveClass('sr-only');
  });

  it('spells out both days when the stay crosses midnight (English)', () => {
    renderRange(NEXT_DAY_END, 'en');
    const range = screen.getByTestId('range');
    expect(spoken(range)).toBe('Mon, Nov 2, 9:00 AM to Tue, Nov 3, 10:00 AM');
  });

  it('names the year when the stay is not this year', () => {
    renderWithProviders(
      <p data-testid="range">
        <StayRange start="2027-10-21T06:00:00.000Z" end="2027-10-21T08:00:00.000Z" />
      </p>,
      { locale: 'el' },
    );
    expect(spoken(screen.getByTestId('range'))).toMatch(/21 Οκτ 2027, 09:00 έως 11:00/);
  });
});
