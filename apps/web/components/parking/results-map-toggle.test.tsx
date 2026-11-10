import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { ResultsMapToggle } from './results-map-toggle';

/** The library behind the map, faked: what the map was given, and its load and error. */
const fake = vi.hoisted(() => ({
  maps: [] as {
    options: Record<string, unknown>;
    handlers: Map<string, () => void>;
    fitBounds: () => void;
  }[],
}));
vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));
vi.mock('@/lib/mapbox-focus.css', () => ({}));
vi.mock('mapbox-gl/dist/mapbox-gl-csp.js', () => ({
  default: {
    version: '0.0.0-test',
    Map: class {
      handlers = new Map<string, () => void>();
      constructor(readonly options: Record<string, unknown>) {
        fake.maps.push(this);
      }
      addControl() {}
      fitBounds = vi.fn();
      remove() {}
      getCanvasContainer() {
        return document.createElement('div');
      }
      once(name: string, handler: () => void) {
        this.handlers.set(name, handler);
      }
    },
    Marker: class {
      setLngLat() {
        return this;
      }
      addTo() {
        return this;
      }
    },
    LngLatBounds: class {
      extend() {
        return this;
      }
    },
    NavigationControl: class {},
  },
}));
const drawn = () => fake.maps[0];

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.resultsMap);
const PINS = [
  {
    number: 1,
    label: { before: 'Result 1: ', name: 'Ermou', nameLang: 'en', after: ', €4.00 in total' },
    href: '/en/parking/ermou',
    latitude: 37.9,
    longitude: 23.7,
  },
];

function show(locale: 'en' | 'el' = 'en') {
  return renderInSubtree(
    <ResultsMapToggle
      token="pk.test"
      pins={PINS}
      center={null}
      show={locale === 'en' ? 'Show the map' : 'Εμφάνιση χάρτη'}
      hide={locale === 'en' ? 'Hide the map' : 'Απόκρυψη χάρτη'}
    >
      <ul data-testid="results" />
    </ResultsMapToggle>,
    { locale },
  );
}

beforeEach(() => {
  fake.maps = [];
});

describe('ResultsMapToggle', () => {
  it('loads nothing of the map until asked', () => {
    show();
    const button = screen.getByRole('button', { name: 'Show the map' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByTestId('results').parentElement).not.toHaveAttribute('data-map');
  });

  it('shows the map above the list on a press, and the cards’ numbers with it', async () => {
    const { container } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Show the map' }));
    const button = screen.getByRole('button', { name: 'Hide the map' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: 'Map of the results' });
    expect(button).toHaveAttribute('aria-controls', region.id);
    expect(screen.getByTestId('results').parentElement).toHaveAttribute('data-map', 'shown');
    // Said once the status line is in the page, so screen readers read it.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading the map…'));
    await waitFor(() => expect(drawn()).toBeDefined());
    expect(drawn()?.options).toMatchObject({ language: 'en' });
    act(() => drawn()?.handlers.get('load')?.());
    expect(screen.getByRole('status')).toHaveTextContent('');
    await expectNoAxeViolations(container);
  });

  it('brings every pin back into view at a press, without dragging (#45)', async () => {
    show();
    expect(screen.queryByRole('button', { name: 'Show all results' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the map' }));
    await waitFor(() => expect(drawn()).toBeDefined());
    const all = screen.getByRole('button', { name: 'Show all results' });
    expect(all).toHaveAttribute('aria-controls', screen.getByRole('region').id);
    await userEvent.click(all);
    expect(drawn()?.fitBounds).toHaveBeenCalledOnce();
    // Hidden with the map.
    await userEvent.click(screen.getByRole('button', { name: 'Hide the map' }));
    expect(screen.queryByRole('button', { name: 'Show all results' })).not.toBeInTheDocument();
  });

  it('says the list has everything when the map can’t load', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Show the map' }));
    await waitFor(() => expect(drawn()).toBeDefined());
    act(() => drawn()?.handlers.get('error')?.());
    expect(screen.getByRole('status')).toHaveTextContent('Every result is in the list');
  });

  it('hides it again, and shows the same map after: each new one is billed', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Show the map' }));
    await waitFor(() => expect(drawn()).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: 'Hide the map' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByTestId('results').parentElement).not.toHaveAttribute('data-map');
    expect(screen.getByRole('button', { name: 'Show the map' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show the map' }));
    expect(screen.getByRole('region', { name: 'Map of the results' })).toBeVisible();
    expect(fake.maps).toHaveLength(1);
  });

  it('speaks Greek', async () => {
    show('el');
    await userEvent.click(screen.getByRole('button', { name: 'Εμφάνιση χάρτη' }));
    expect(screen.getByRole('region', { name: 'Χάρτης των αποτελεσμάτων' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Φόρτωση χάρτη…'));
  });
});
