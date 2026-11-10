/**
 * Copied there by scripts/copy-mapbox-worker.mjs: a strict CSP allows workers from our origin. The
 * library's version is in the name, so the cached file always matches the library asking for it.
 */
export const workerUrlFor = (version: string) => `/vendor/mapbox-gl-csp-worker-${version}.js`;

/** A classic style: the Standard one needs `wasm-unsafe-eval`, which the CSP doesn't allow. */
export const MAPBOX_STYLE = 'mapbox://styles/mapbox/streets-v12';
