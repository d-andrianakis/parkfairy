/** Accepts only same-site relative paths, so `?next=` cannot become an open redirect. */
export function safeRedirectPath(value: string | null | undefined, fallback = '/account'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}
