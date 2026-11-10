'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import '@/lib/mapbox-focus.css';
import type { LngLatBoundsLike, Map as MapboxMap } from 'mapbox-gl';
import { useEffect, useRef } from 'react';
import { greekRuns } from '@/lib/greek-runs';
import { markAttributionEnglish, MAPBOX_STYLE, workerUrlFor } from '@/lib/mapbox';

export interface ResultPin {
  number: number;
  /**
   * The pin's name, around the listing's: the name is the owner's text, so it is marked with its
   * own language, which an `aria-label` couldn't carry.
   */
  label: { before: string; name: string; nameLang: string; after: string };
  href: string;
  latitude: number;
  longitude: number;
}

export interface ResultsMapLabels {
  /** The canvas's own name; the section around the map has the other. */
  canvas: string;
  zoomIn: string;
  zoomOut: string;
  attribution: string;
  logo: string;
  searched: string;
  /** What cooperative gestures say when one finger or a plain wheel meets the map. */
  zoomHintCtrl: string;
  zoomHintCmd: string;
  panHint: string;
}

export interface ResultsMapProps {
  token: string;
  locale: string;
  labels: ResultsMapLabels;
  pins: ResultPin[];
  /** Where the search was made, marked apart from the results. */
  center: { latitude: number; longitude: number } | null;
  /** Drawn: the words standing in for it can go. */
  onReady: () => void;
  onFail: () => void;
  /** Raised by "Show all results": every pin and the searched point back in view. */
  fitRequest?: number;
}

/** The tiles are light in both themes, so the focus ring is the light theme's, with a halo. */
const FIT = { padding: 48, maxZoom: 16 };

const PIN_CLASSES =
  'grid size-8 place-items-center rounded-full border-2 border-white bg-primary text-sm font-semibold text-primary-foreground no-underline shadow-md outline-none focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.36_0.18_264.376)] focus-visible:ring-6 focus-visible:ring-white';

function span(text: string, attributes: Record<string, string> = {}) {
  const element = document.createElement('span');
  element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

/** A link on the map, named by its text: its number shown, its whole name for screen readers. */
function pinElement(pin: ResultPin): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = pin.href;
  link.className = PIN_CLASSES;
  link.append(span(String(pin.number), { 'aria-hidden': 'true' }));
  const name = span(pin.label.before, { class: 'sr-only' });
  const listing = span('', { lang: pin.label.nameLang });
  // Greek words inside an English name marked apart, as `PlaceWords` does in the list.
  for (const run of greekRuns(pin.label.name, pin.label.nameLang)) {
    listing.append(run.lang ? span(run.text, { lang: run.lang }) : run.text);
  }
  name.append(listing, pin.label.after);
  link.append(name);
  return link;
}

function centerElement(label: string): HTMLDivElement {
  const dot = document.createElement('div');
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', label);
  dot.className = 'size-4 rounded-full border-2 border-white bg-foreground shadow-md';
  return dot;
}

/**
 * The results as numbered pins, each a link to its listing, with the searched point marked. Only
 * a companion to the list, which has everything this does: it loads when asked for (each map shown
 * is billed, and the CSP build is 470 KiB), and Mapbox is allowed on the search page alone (#41).
 */
export default function ResultsMap({
  token,
  locale,
  labels,
  pins,
  center,
  onReady,
  onFail,
  fitRequest = 0,
}: ResultsMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const drawn = useRef<{ map: MapboxMap; bounds: LngLatBoundsLike } | null>(null);
  const failed = useRef(onFail);
  const ready = useRef(onReady);
  useEffect(() => {
    failed.current = onFail;
    ready.current = onReady;
  }, [onFail, onReady]);

  useEffect(() => {
    let cancelled = false;
    let map: MapboxMap | null = null;
    async function start() {
      const { default: mapboxgl } = await import('mapbox-gl/dist/mapbox-gl-csp.js');
      if (cancelled || !container.current) return;
      mapboxgl.workerUrl = workerUrlFor(mapboxgl.version);
      mapboxgl.accessToken = token;
      const bounds = new mapboxgl.LngLatBounds();
      for (const pin of pins) bounds.extend([pin.longitude, pin.latitude]);
      if (center) bounds.extend([center.longitude, center.latitude]);
      const created = new mapboxgl.Map({
        container: container.current,
        style: MAPBOX_STYLE,
        language: locale,
        bounds,
        fitBoundsOptions: FIT,
        // One finger scrolls the page and a plain wheel the page too, as a phone user expects of a
        // map in the middle of a list (#45); two fingers or Ctrl move the map, as the hints say.
        cooperativeGestures: true,
        // Its controls speak English unless told otherwise.
        locale: {
          'Map.Title': labels.canvas,
          'NavigationControl.ZoomIn': labels.zoomIn,
          'NavigationControl.ZoomOut': labels.zoomOut,
          'AttributionControl.ToggleAttribution': labels.attribution,
          'LogoControl.Title': labels.logo,
          'ScrollZoomBlocker.CtrlMessage': labels.zoomHintCtrl,
          'ScrollZoomBlocker.CmdMessage': labels.zoomHintCmd,
          'TouchPanBlocker.Message': labels.panHint,
        },
      });
      map = created;
      drawn.current = { map: created, bounds };
      markAttributionEnglish(container.current);
      created.addControl(new mapboxgl.NavigationControl({ showCompass: false }));
      if (center) {
        new mapboxgl.Marker({ element: centerElement(labels.searched) })
          .setLngLat([center.longitude, center.latitude])
          .addTo(created);
      }
      // In the list's order, which is the order they are tabbed to.
      for (const pin of pins) {
        const element = pinElement(pin);
        const position: [number, number] = [pin.longitude, pin.latitude];
        new mapboxgl.Marker({ element }).setLngLat(position).addTo(created);
        // Mapbox makes every marker an image named "Map marker": this one is a link, named by its text.
        element.removeAttribute('role');
        element.removeAttribute('aria-label');
        // Tabbed to while out of view (after zooming in): bring it into view, not off the edge.
        element.addEventListener('focus', () => {
          if (!created.getBounds()?.contains(position)) created.easeTo({ center: position });
        });
      }
      created.once('load', () => ready.current());
      // A refused token or a blocked style arrives here, not as an exception.
      created.once('error', () => failed.current());
    }
    start().catch(() => failed.current());
    return () => {
      cancelled = true;
      drawn.current = null;
      map?.remove();
    };
  }, [token, locale, labels, pins, center]);

  useEffect(() => {
    if (fitRequest > 0) drawn.current?.map.fitBounds(drawn.current.bounds, FIT);
  }, [fitRequest]);

  return <div ref={container} className="absolute inset-0 overflow-hidden rounded-lg" />;
}
