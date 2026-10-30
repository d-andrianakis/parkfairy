const POSITION_PARAMS = /([?&](?:latitude|longitude)=)[^&]*/gi;

/** Request URL for logs, without the visitor's position (search by "my location"). */
export function redactUrl(url: string): string {
  return url.replace(POSITION_PARAMS, '$1[redacted]');
}
