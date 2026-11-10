import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResultsMap, { type ResultsMapProps } from './results-map';

const fake = vi.hoisted(() => {
  const created: {
    maps: FakeMap[];
    bounds: [number, number][];
    fail: boolean;
    library: { accessToken: string; workerUrl: string } | null;
  } = { maps: [], bounds: [], fail: false, library: null };

  class FakeMarker {
    position: [number, number] | null = null;
    constructor(readonly options: { element: HTMLElement }) {
      // As mapbox-gl 3.34 does to any element it is given.
      const element = options.element;
      if (!element.hasAttribute('aria-label')) element.setAttribute('aria-label', 'Map marker');
      if (!element.hasAttribute('role')) element.setAttribute('role', 'img');
    }
    setLngLat = (position: [number, number]) => {
      this.position = position;
      return this;
    };
    addTo = (map: FakeMap) => {
      map.layer.appendChild(this.options.element);
      return this;
    };
  }

  class FakeMap {
    handlers = new Map<string, () => void>();
    layer: HTMLElement;
    remove = vi.fn();
    addControl = vi.fn();
    easeTo = vi.fn();
    fitBounds = vi.fn();
    /** What is in view: only around the first pin. */
    getBounds = () => ({ contains: ([lng]: [number, number]) => lng === 23.733 });
    constructor(readonly options: { container: HTMLElement } & Record<string, unknown>) {
      created.maps.push(this);
      this.layer = document.createElement('div');
      options.container.appendChild(this.layer);
      // As Mapbox's attribution control, added by the constructor, writes it.
      const attribution = document.createElement('div');
      attribution.className = 'mapboxgl-ctrl-attrib-inner';
      attribution.textContent = '© Mapbox © OpenStreetMap Improve this map';
      options.container.appendChild(attribution);
    }
    getCanvasContainer = () => this.layer;
    once = (name: string, handler: () => void) => {
      this.handlers.set(name, handler);
    };
  }

  class FakeBounds {
    extend = (point: [number, number]) => {
      created.bounds.push(point);
      return this;
    };
  }

  return { created, FakeMap, FakeMarker, FakeBounds };
});

vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));
vi.mock('@/lib/mapbox-focus.css', () => ({}));
vi.mock('mapbox-gl/dist/mapbox-gl-csp.js', () => {
  const library = {
    version: '0.0.0-test',
    workerUrl: '',
    accessToken: '',
    get Map() {
      if (fake.created.fail) throw new Error('No WebGL');
      return fake.FakeMap;
    },
    Marker: fake.FakeMarker,
    LngLatBounds: fake.FakeBounds,
    NavigationControl: class {},
  };
  fake.created.library = library;
  return { default: library };
});

const PINS = [
  {
    number: 1,
    label: {
      before: 'Result 1: ',
      name: 'Γκαράζ Ερμού',
      nameLang: 'el',
      after: ', €4.00 in total',
    },
    href: '/en/parking/ermou?startDate=2026-12-10',
    latitude: 37.976,
    longitude: 23.733,
  },
  {
    number: 2,
    label: { before: 'Result 2: ', name: 'Syntagma', nameLang: 'en', after: ', €6.00 in total' },
    href: '/en/parking/syntagma?startDate=2026-12-10',
    latitude: 37.975,
    longitude: 23.735,
  },
];

function props(overrides: Partial<ResultsMapProps> = {}): ResultsMapProps {
  return {
    token: 'pk.test',
    locale: 'en',
    labels: {
      canvas: 'Map: the arrow keys move it, plus and minus zoom',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      attribution: 'Show map information',
      logo: 'Mapbox home page',
      searched: 'Where you searched',
      zoomHintCtrl: 'Use Ctrl + scroll to zoom the map',
      zoomHintCmd: 'Use ⌘ + scroll to zoom the map',
      panHint: 'Use two fingers to move the map',
    },
    pins: PINS,
    center: { latitude: 37.9755, longitude: 23.7348 },
    onReady: vi.fn(),
    onFail: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  fake.created.maps = [];
  fake.created.bounds = [];
  fake.created.fail = false;
});

describe('ResultsMap', () => {
  it('marks Mapbox’s attribution as the English it is written in, on a Greek page too', async () => {
    const { container } = render(<ResultsMap {...props({ locale: 'el' })} />);
    await waitFor(() => expect(fake.created.maps).toHaveLength(1));
    expect(container.querySelector('.mapboxgl-ctrl-attrib-inner')).toHaveAttribute('lang', 'en');
  });

  it('fits every pin and the searched point, in the page language, with its controls named', async () => {
    render(<ResultsMap {...props()} />);
    await waitFor(() => expect(fake.created.maps).toHaveLength(1));
    const [map] = fake.created.maps;
    expect(map?.options).toMatchObject({
      style: 'mapbox://styles/mapbox/streets-v12',
      language: 'en',
      locale: {
        'Map.Title': 'Map: the arrow keys move it, plus and minus zoom',
        'NavigationControl.ZoomIn': 'Zoom in',
        'LogoControl.Title': 'Mapbox home page',
      },
    });
    expect(fake.created.bounds).toEqual([
      [23.733, 37.976],
      [23.735, 37.975],
      [23.7348, 37.9755],
    ]);
  });

  it('leaves one finger and a plain wheel to the page, saying how to move the map (#45)', async () => {
    render(<ResultsMap {...props()} />);
    await waitFor(() => expect(fake.created.maps).toHaveLength(1));
    expect(fake.created.maps[0]?.options).toMatchObject({
      cooperativeGestures: true,
      locale: {
        'ScrollZoomBlocker.CtrlMessage': 'Use Ctrl + scroll to zoom the map',
        'ScrollZoomBlocker.CmdMessage': 'Use ⌘ + scroll to zoom the map',
        'TouchPanBlocker.Message': 'Use two fingers to move the map',
      },
    });
  });

  it('fits every pin back in view when asked, not before', async () => {
    // The same props, as the toggle keeps them: new labels would start a new map.
    const same = props();
    const { rerender } = render(<ResultsMap {...same} />);
    await waitFor(() => expect(fake.created.maps).toHaveLength(1));
    const map = fake.created.maps[0];
    expect(map?.fitBounds).not.toHaveBeenCalled();
    rerender(<ResultsMap {...same} fitRequest={1} />);
    expect(fake.created.maps).toHaveLength(1);
    expect(map?.fitBounds).toHaveBeenCalledWith(map?.options.bounds, {
      padding: 48,
      maxZoom: 16,
    });
  });

  it('uses the token, and the worker from this site that the CSP allows', async () => {
    render(<ResultsMap {...props()} />);
    await waitFor(() => expect(fake.created.maps).toHaveLength(1));
    expect(fake.created.library).toMatchObject({
      accessToken: 'pk.test',
      workerUrl: '/vendor/mapbox-gl-csp-worker-0.0.0-test.js',
    });
  });

  it('makes each pin a link named in full, the listing in its own language, in the list’s order', async () => {
    const { container } = render(<ResultsMap {...props()} />);
    const links = await screen.findAllByRole('link');
    // Mapbox would have made each an image called "Map marker".
    expect(links.map((link) => link.getAttribute('role'))).toEqual([null, null]);
    expect(links[0]).toHaveAccessibleName('Result 1: Γκαράζ Ερμού, €4.00 in total');
    expect(links[1]).toHaveAccessibleName('Result 2: Syntagma, €6.00 in total');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(PINS.map((pin) => pin.href));
    expect(links[0]?.querySelector('[lang="el"]')).toHaveTextContent('Γκαράζ Ερμού');
    expect(links[1]?.querySelector('[lang="en"]')).toHaveTextContent('Syntagma');
    expect(links[0]?.querySelector('[aria-hidden="true"]')).toHaveTextContent('1');
    expect(screen.getByRole('img', { name: 'Where you searched' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('brings a pin out of view into view when it is tabbed to', async () => {
    render(<ResultsMap {...props()} />);
    const links = await screen.findAllByRole('link');
    act(() => links[0]?.focus());
    expect(fake.created.maps[0]?.easeTo).not.toHaveBeenCalled();
    act(() => links[1]?.focus());
    expect(fake.created.maps[0]?.easeTo).toHaveBeenCalledWith({ center: [23.735, 37.975] });
  });

  it('says when it has drawn, and when it cannot', async () => {
    const ready = props();
    render(<ResultsMap {...ready} />);
    await waitFor(() => expect(fake.created.maps).toHaveLength(1));
    act(() => fake.created.maps[0]?.handlers.get('load')?.());
    expect(ready.onReady).toHaveBeenCalledOnce();
    act(() => fake.created.maps[0]?.handlers.get('error')?.());
    expect(ready.onFail).toHaveBeenCalledOnce();

    fake.created.fail = true;
    const broken = props();
    render(<ResultsMap {...broken} />);
    await waitFor(() => expect(broken.onFail).toHaveBeenCalledOnce());
  });

  it('marks the Greek words of an English listing’s name on its pin', async () => {
    const [first] = PINS;
    if (!first) throw new Error('No pin');
    render(
      <ResultsMap
        {...props({
          pins: [{ ...first, label: { ...first.label, name: 'Garage Ερμού 10', nameLang: 'en' } }],
        })}
      />,
    );
    const [link] = await screen.findAllByRole('link');
    expect(link).toHaveAccessibleName('Result 1: Garage Ερμού 10, €4.00 in total');
    const name = link?.querySelector('[lang="en"]');
    expect(name?.querySelector('[lang="el"]')).toHaveTextContent(/^Ερμού$/);
  });

  it('removes the map when it goes', async () => {
    const { unmount } = render(<ResultsMap {...props()} />);
    await waitFor(() => expect(fake.created.maps).toHaveLength(1));
    unmount();
    expect(fake.created.maps[0]?.remove).toHaveBeenCalledOnce();
  });
});
