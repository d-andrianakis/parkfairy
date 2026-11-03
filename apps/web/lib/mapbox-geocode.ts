export interface AddressMatch {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface GeocodeFeature {
  id: string;
  geometry: { coordinates: [number, number] };
  properties: { full_address?: string; name?: string };
}

const ENDPOINT = 'https://api.mapbox.com/search/geocode/v6/forward';
const MAX_MATCHES = 5;

/**
 * Addresses matching what an owner typed. Run on a button press, not on each key: every request
 * is billed, and a list that changes while someone types is hard to follow with a screen reader.
 * `permanent` because the point is stored, which Mapbox's terms don't allow for temporary results.
 */
export async function findAddress(
  query: string,
  token: string,
  language: string,
  fetchFn: typeof fetch = fetch,
): Promise<AddressMatch[] | null> {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    q: query,
    access_token: token,
    country: 'gr',
    language,
    limit: String(MAX_MATCHES),
    permanent: 'true',
  }).toString();
  try {
    const response = await fetchFn(url);
    if (!response.ok) return null;
    const { features } = (await response.json()) as { features: GeocodeFeature[] };
    return features.map(({ id, geometry, properties }) => ({
      id,
      address: properties.full_address ?? properties.name ?? '',
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
    }));
  } catch {
    return null;
  }
}
