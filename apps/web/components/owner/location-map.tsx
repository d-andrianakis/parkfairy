'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import type { Map as MapboxMap, Marker } from 'mapbox-gl';
import { useEffect, useRef } from 'react';

/**
 * Copied there by scripts/copy-mapbox-worker.mjs: a strict CSP allows workers from our origin. The
 * library's version is in the name, so the cached file always matches the library asking for it.
 */
export const workerUrlFor = (version: string) => `/vendor/mapbox-gl-csp-worker-${version}.js`;
/** A classic style: the Standard one needs `wasm-unsafe-eval`, which the CSP doesn't allow. */
const STYLE = 'mapbox://styles/mapbox/streets-v12';
/** Attica, until there is a pin. */
const DEFAULT_CENTER: [number, number] = [23.7275, 37.9838];

export interface LocationMapLabels {
  /** The map as a whole. */
  map: string;
  pin: string;
  zoomIn: string;
  zoomOut: string;
  attribution: string;
  logo: string;
}

export interface LocationMapProps {
  token: string;
  locale: string;
  labels: LocationMapLabels;
  latitude: number | null;
  longitude: number | null;
  onPick: (latitude: number, longitude: number) => void;
  /** The map couldn't start; the fields beside it still work. */
  onFail: () => void;
}

/**
 * The pin on a map. Press to place it, or drag it; the coordinates beside the map do the same
 * job without a pointer (WCAG 2.5.7). This file, with the 470 KiB CSP build it loads, only comes
 * when the owner asks for the map, because each map shown is also a billed map load.
 */
export default function LocationMap({
  token,
  locale,
  labels,
  latitude,
  longitude,
  onPick,
  onFail,
}: LocationMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapboxMap | null>(null);
  const marker = useRef<Marker | null>(null);
  // Refs, because the code takes a while to load and the pin may move in the meantime.
  const latest = useRef({ latitude, longitude, onPick, onFail });
  useEffect(() => {
    latest.current = { latitude, longitude, onPick, onFail };
  }, [latitude, longitude, onPick, onFail]);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      const { default: mapboxgl } = await import('mapbox-gl/dist/mapbox-gl-csp.js');
      if (cancelled || !container.current) return;
      const pinned = latest.current;
      const position =
        pinned.latitude !== null && pinned.longitude !== null
          ? ([pinned.longitude, pinned.latitude] as [number, number])
          : null;
      mapboxgl.workerUrl = workerUrlFor(mapboxgl.version);
      mapboxgl.accessToken = token;
      const created = new mapboxgl.Map({
        container: container.current,
        style: STYLE,
        language: locale,
        center: position ?? DEFAULT_CENTER,
        zoom: position ? 16 : 10,
        // Its controls speak English unless told otherwise.
        locale: {
          'Map.Title': labels.map,
          'NavigationControl.ZoomIn': labels.zoomIn,
          'NavigationControl.ZoomOut': labels.zoomOut,
          'AttributionControl.ToggleAttribution': labels.attribution,
          'LogoControl.Title': labels.logo,
        },
      });
      created.addControl(new mapboxgl.NavigationControl({ showCompass: false }));
      const pin = new mapboxgl.Marker({ draggable: true, color: '#092c99' });
      pin.getElement().setAttribute('aria-label', labels.pin);
      if (position) pin.setLngLat(position).addTo(created);
      pin.on('dragend', () => {
        const { lat, lng } = pin.getLngLat();
        latest.current.onPick(lat, lng);
      });
      created.on('click', ({ lngLat }) => {
        pin.setLngLat(lngLat).addTo(created);
        latest.current.onPick(lngLat.lat, lngLat.lng);
      });
      // A refused token or a blocked style arrives here, not as an exception.
      created.once('error', () => latest.current.onFail());
      map.current = created;
      marker.current = pin;
    }
    start().catch(() => latest.current.onFail());
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, [token, locale, labels]);

  useEffect(() => {
    const created = map.current;
    if (!created || !marker.current || latitude === null || longitude === null) return;
    marker.current.setLngLat([longitude, latitude]).addTo(created);
    created.easeTo({ center: [longitude, latitude], zoom: Math.max(created.getZoom(), 16) });
  }, [latitude, longitude]);

  return (
    <div
      ref={container}
      role="application"
      aria-label={labels.map}
      className="size-full overflow-hidden rounded-lg"
    />
  );
}
