/**
 * The Better Auth endpoints this origin serves. Everything else, sign-up, password reset, account
 * changes, two-factor set-up, answers 404: the staff app is somewhere to sign in, not another door
 * into accounts, and a second factor is enrolled on the public site's account page.
 */
const ALLOWED: ReadonlySet<string> = new Set([
  'POST /sign-in/email',
  'POST /two-factor/verify-totp',
  'POST /two-factor/verify-backup-code',
  'POST /sign-out',
]);

const PREFIX = '/api/auth';

/** Whether a request may reach Better Auth: its method and path, trailing slash ignored. */
export function isAllowedAuthRequest(method: string, pathname: string): boolean {
  if (!pathname.startsWith(`${PREFIX}/`)) return false;
  const path = pathname.slice(PREFIX.length).replace(/\/+$/, '');
  return ALLOWED.has(`${method.toUpperCase()} ${path}`);
}

/**
 * Options of the allowed endpoints that this app never sends and must not accept: `trustDevice`
 * makes Better Auth remember the browser for 30 days, so a password alone would then sign in
 * without the second factor.
 */
export function bodyIsAllowed(parsed: unknown): boolean {
  return !(
    typeof parsed === 'object' &&
    parsed !== null &&
    'trustDevice' in parsed &&
    (parsed as { trustDevice?: unknown }).trustDevice
  );
}
