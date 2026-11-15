import { parseServerEnv } from './server-env';

/** The public site's account page in a language: where staff turn on a second factor. */
export function accountPageUrl(locale: string): string {
  return new URL(`/${locale}/account`, parseServerEnv(process.env).BETTER_AUTH_URL).href;
}
