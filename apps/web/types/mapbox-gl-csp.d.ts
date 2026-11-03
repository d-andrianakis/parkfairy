/** The build for strict CSPs: the same library, with its worker loaded from a URL we choose. */
declare module 'mapbox-gl/dist/mapbox-gl-csp.js' {
  import mapboxgl from 'mapbox-gl';

  const csp: typeof mapboxgl & { workerUrl: string };
  export default csp;
}
