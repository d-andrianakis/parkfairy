import 'server-only';

import { cookies } from 'next/headers';

import { parseTheme, type Theme, THEME_COOKIE } from './theme';

/** The theme saved for this browser (see `applyTheme`), validated. */
export async function getTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
