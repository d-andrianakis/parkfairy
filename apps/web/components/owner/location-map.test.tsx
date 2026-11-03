import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LocationMap, { type LocationMapProps } from './location-map';

type Handler = (event: { lngLat: { lat: number; lng: number } }) => void;

const fake = vi.hoisted(() => {
  const created: { maps: FakeMap[]; markers: FakeMarker[]; fail: boolean } = {
    maps: [],
    markers: [],
    fail: false,
  };

  class FakeMarker {
    handlers = new Map<string, () => void>();
    position: [number, number] | null = null;
    element = { setAttribute: vi.fn() };
    constructor() {
      created.markers.push(this);
    }
    getElement = () => this.element;
    setLngLat = (position: [number, number]) => {
      this.position = position;
      return this;
    };
    addTo = vi.fn(() => this);
    getLngLat = () => ({ lat: 37.5, lng: 23.5 });
    on = (name: string, handler: () => void) => {
      this.handlers.set(name, handler);
    };
  }

  class FakeMap {
    handlers = new Map<string, Handler>();
    remove = vi.fn();
    easeTo = vi.fn();
    addControl = vi.fn();
    getZoom = () => 10;
    constructor(readonly options: Record<string, unknown>) {
      created.maps.push(this);
    }
    on = (name: string, handler: Handler) => {
      this.handlers.set(name, handler);
    };
    once = this.on;
  }

  return { created, FakeMap, FakeMarker };
});

vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));
vi.mock('mapbox-gl/dist/mapbox-gl-csp.js', () => {
  const library = {
    workerUrl: '',
    accessToken: '',
    get Map() {
      if (fake.created.fail) throw new Error('No WebGL');
      return fake.FakeMap;
    },
    Marker: fake.FakeMarker,
    NavigationControl: class {},
  };
  return { default: library };
});

const labels = {
  map: 'Χάρτης',
  pin: 'Πινέζα',
  zoomIn: 'Μεγέθυνση',
  zoomOut: 'Σμίκρυνση',
  attribution: 'Πληροφορίες',
  logo: 'Mapbox',
};

function props(overrides: Partial<LocationMapProps> = {}): LocationMapProps {
  return {
    token: 'pk.test',
    locale: 'el',
    labels,
    latitude: null,
    longitude: null,
    onPick: vi.fn(),
    onFail: vi.fn(),
    ...overrides,
  };
}

const started = () => waitFor(() => expect(fake.created.maps).toHaveLength(1));
const theMap = () => {
  const map = fake.created.maps[0];
  if (!map) throw new Error('No map');
  return map;
};
const theMarker = () => {
  const marker = fake.created.markers[0];
  if (!marker) throw new Error('No marker');
  return marker;
};

describe('LocationMap', () => {
  beforeEach(() => {
    fake.created.maps.length = 0;
    fake.created.markers.length = 0;
    fake.created.fail = false;
  });

  it('starts in the page’s language, with a style that needs no eval', async () => {
    render(<LocationMap {...props()} />);
    await started();
    const { options } = theMap();
    expect(options.language).toBe('el');
    expect(options.style).toBe('mapbox://styles/mapbox/streets-v12');
    expect(options.locale).toMatchObject({ 'NavigationControl.ZoomIn': 'Μεγέθυνση' });
  });

  it('takes the worker from our own origin and names the pin', async () => {
    const { default: library } = await import('mapbox-gl/dist/mapbox-gl-csp.js');
    render(<LocationMap {...props()} />);
    await started();
    expect(library.workerUrl).toBe('/vendor/mapbox-gl-csp-worker.js');
    expect(library.accessToken).toBe('pk.test');
    expect(theMarker().element.setAttribute).toHaveBeenCalledWith('aria-label', 'Πινέζα');
  });

  it('opens on a saved pin, close enough to check it', async () => {
    render(<LocationMap {...props({ latitude: 37.97, longitude: 23.73 })} />);
    await started();
    expect(theMap().options).toMatchObject({ center: [23.73, 37.97], zoom: 16 });
    expect(theMarker().addTo).toHaveBeenCalled();
  });

  it('shows no pin until there is one', async () => {
    render(<LocationMap {...props()} />);
    await started();
    expect(theMarker().addTo).not.toHaveBeenCalled();
  });

  it('places the pin on a press, and reports it', async () => {
    const onPick = vi.fn();
    render(<LocationMap {...props({ onPick })} />);
    await started();
    theMap().handlers.get('click')?.({ lngLat: { lat: 37.1, lng: 23.2 } });
    expect(onPick).toHaveBeenCalledWith(37.1, 23.2);
    expect(theMarker().addTo).toHaveBeenCalled();
  });

  it('reports a dragged pin', async () => {
    const onPick = vi.fn();
    render(<LocationMap {...props({ onPick })} />);
    await started();
    theMarker().handlers.get('dragend')?.();
    expect(onPick).toHaveBeenCalledWith(37.5, 23.5);
  });

  it('follows a pin set elsewhere on the page', async () => {
    const { rerender } = render(<LocationMap {...props()} />);
    await started();
    rerender(<LocationMap {...props({ latitude: 38, longitude: 24 })} />);
    expect(theMarker().position).toEqual([24, 38]);
    expect(theMap().easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [24, 38] }));
  });

  it('opens on a pin chosen while its code was loading', async () => {
    const stable = props();
    const { rerender } = render(<LocationMap {...stable} />);
    rerender(<LocationMap {...stable} latitude={38} longitude={24} />);
    await started();
    expect(theMap().options).toMatchObject({ center: [24, 38] });
  });

  it('removes the map when it goes', async () => {
    const { unmount } = render(<LocationMap {...props()} />);
    await started();
    const map = theMap();
    unmount();
    expect(map.remove).toHaveBeenCalled();
  });

  it('creates nothing if it goes before its code arrives', async () => {
    const { unmount } = render(<LocationMap {...props()} />);
    unmount();
    await act(() => Promise.resolve());
    expect(fake.created.maps).toHaveLength(0);
  });

  it('reports a map that can’t start, instead of an unhandled rejection', async () => {
    fake.created.fail = true;
    const onFail = vi.fn();
    render(<LocationMap {...props({ onFail })} />);
    await waitFor(() => expect(onFail).toHaveBeenCalled());
  });

  it('reports a refused token, which arrives as an event', async () => {
    const onFail = vi.fn();
    render(<LocationMap {...props({ onFail })} />);
    await started();
    theMap().handlers.get('error')?.({ lngLat: { lat: 0, lng: 0 } });
    expect(onFail).toHaveBeenCalled();
  });

  it('names itself for screen readers', async () => {
    render(<LocationMap {...props()} />);
    expect(screen.getByRole('application', { name: 'Χάρτης' })).toBeInTheDocument();
    await started();
  });
});
