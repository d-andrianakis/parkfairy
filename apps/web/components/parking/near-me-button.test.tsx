import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { NearMeButton } from './near-me-button';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.searchForm);

function Form() {
  return (
    <form aria-label="search">
      <select name="area" defaultValue="syntagma" aria-label="area">
        <option value="">-</option>
        <option value="syntagma">Syntagma</option>
      </select>
      <input type="hidden" name="latitude" defaultValue="" />
      <input type="hidden" name="longitude" defaultValue="" />
      <NearMeButton />
    </form>
  );
}

const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>();
const requestSubmit = vi.fn();

beforeEach(() => {
  getCurrentPosition.mockReset();
  requestSubmit.mockReset();
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
  vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(requestSubmit);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const deniedError = { code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError;

describe('NearMeButton', () => {
  it('searches near the browser position, rounded to about 100 m', async () => {
    getCurrentPosition.mockImplementation((success) =>
      success({ coords: { latitude: 37.975512, longitude: 23.734849 } } as GeolocationPosition),
    );
    const { container } = renderInSubtree(<Form />);
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));

    const form = container.querySelector('form') as HTMLFormElement;
    expect(new FormData(form).get('latitude')).toBe('37.976');
    expect(new FormData(form).get('longitude')).toBe('23.735');
    expect(new FormData(form).get('area')).toBe('');
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    // Bounded, so "Finding your location…" can never hang.
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it('explains a blocked permission in the page language, without submitting', async () => {
    getCurrentPosition.mockImplementation((_success, error) => error?.(deniedError));
    renderInSubtree(<Form />, { locale: 'el' });
    await userEvent.click(screen.getByRole('button', { name: 'Χρήση τοποθεσίας' }));

    expect(
      screen.getByText('Η πρόσβαση στην τοποθεσία είναι αποκλεισμένη. Επιλέξτε περιοχή.'),
    ).toHaveAttribute('aria-live', 'polite');
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it('copes with browsers that have no geolocation', async () => {
    vi.stubGlobal('navigator', {});
    renderInSubtree(<Form />);
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(
      screen.getByText('Your location isn’t available. Choose an area instead.'),
    ).toBeInTheDocument();
  });

  it('reports a timeout as "unavailable"', async () => {
    getCurrentPosition.mockImplementation((_success, error) =>
      error?.({ code: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    renderInSubtree(<Form />);
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(
      screen.getByText('Your location isn’t available. Choose an area instead.'),
    ).toBeInTheDocument();
  });

  it('announces that it is locating, keeps focus and ignores repeat presses', async () => {
    getCurrentPosition.mockImplementation(() => {});
    const { container } = renderInSubtree(<Form />);
    const button = screen.getByRole('button', { name: 'Use my location' });
    await userEvent.click(button);
    await userEvent.click(button);

    expect(screen.getByText('Finding your location…')).toHaveAttribute('aria-live', 'polite');
    // aria-disabled, not disabled: a disabled button would drop focus to <body>.
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    expect(button).toHaveAccessibleDescription('Finding your location…');
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations(container);
  });

  it('keeps its (empty) live region in the accessibility tree from the start', () => {
    renderInSubtree(<Form />);
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).toBeInTheDocument();
    expect(region).toHaveClass('empty:sr-only');
    expect(region).not.toHaveClass('empty:hidden');
  });
});
