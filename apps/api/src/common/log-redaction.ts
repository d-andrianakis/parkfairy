/**
 * Query parameters that say where someone is or wants to be: the position ("my location", a picked
 * place) and an address as it is typed (`q`), with the ids that would tie one person's keystrokes
 * together (`session`, and the picked place's `id`). Logs keep that they were there, not what.
 */
const PERSONAL_PARAMS = /([?&](?:latitude|longitude|q|session|id)=)[^&]*/gi;

/** Request URL for logs, without where the visitor is or what address they typed. */
export function redactUrl(url: string): string {
  return url.replace(PERSONAL_PARAMS, '$1[redacted]');
}
