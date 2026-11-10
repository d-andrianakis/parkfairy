import 'server-only';

/**
 * The public Mapbox token, or null: whether this deployment has maps and address search at all
 * (decision #42). With none, the location step, the search form and the results work without them.
 */
export function mapboxToken(): string | null {
  return process.env.MAPBOX_PUBLIC_TOKEN || null;
}
