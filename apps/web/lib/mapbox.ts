/**
 * Copied there by scripts/copy-mapbox-worker.mjs: a strict CSP allows workers from our origin. The
 * library's version is in the name, so the cached file always matches the library asking for it.
 */
export const workerUrlFor = (version: string) => `/vendor/mapbox-gl-csp-worker-${version}.js`;

/** A classic style: the Standard one needs `wasm-unsafe-eval`, which the CSP doesn't allow. */
export const MAPBOX_STYLE = 'mapbox://styles/mapbox/streets-v12';

/**
 * Mapbox writes its attribution ("© Mapbox © OpenStreetMap Improve this map") in English whatever
 * the page's language, so it is marked as English: on a Greek page a screen reader would otherwise
 * read it with the Greek voice (WCAG 3.1.2). Its toggle's name is ours, translated, and stays as is.
 */
export function markAttributionEnglish(container: HTMLElement) {
  container.querySelector('.mapboxgl-ctrl-attrib-inner')?.setAttribute('lang', 'en');
}
