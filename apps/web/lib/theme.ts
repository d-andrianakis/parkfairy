export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The reader's explicit choice, per device. No cookie means "system": the CSS follows
 * `prefers-color-scheme`. Not sensitive, so it is readable by scripts and not HttpOnly.
 */
export const THEME_COOKIE = 'theme';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

/** Cookie values are user-controlled: anything unexpected falls back to "system". */
export function parseTheme(value: string | undefined): Theme {
  return isTheme(value) ? value : 'system';
}

/** Class for `<html>`: `light`/`dark` pin the theme, none lets the OS decide (globals.css). */
export function themeClassName(theme: Theme): string | undefined {
  return theme === 'system' ? undefined : theme;
}

/** Switches the page immediately and remembers the choice for server rendering. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  const className = themeClassName(theme);
  if (className) root.classList.add(className);

  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    theme === 'system'
      ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}
