import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, parseTheme, themeClassName } from './theme';

function themeCookie() {
  return document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('theme='))
    ?.slice('theme='.length);
}

describe('parseTheme', () => {
  it('accepts the known themes', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
  });

  it('falls back to the OS setting for missing or tampered cookies', () => {
    expect(parseTheme(undefined)).toBe('system');
    expect(parseTheme('')).toBe('system');
    expect(parseTheme('dark" onload="alert(1)')).toBe('system');
    expect(parseTheme('constructor')).toBe('system');
  });
});

describe('themeClassName', () => {
  it('pins an explicit choice and leaves "system" to CSS', () => {
    expect(themeClassName('dark')).toBe('dark');
    expect(themeClassName('light')).toBe('light');
    expect(themeClassName('system')).toBeUndefined();
  });
});

describe('applyTheme', () => {
  afterEach(() => applyTheme('system'));

  it('switches the page and remembers the choice', () => {
    applyTheme('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement).not.toHaveClass('light');
    expect(themeCookie()).toBe('dark');

    applyTheme('light');
    expect(document.documentElement).toHaveClass('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(themeCookie()).toBe('light');
  });

  it('forgets the choice when going back to the OS setting', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(document.documentElement.className).toBe('');
    expect(themeCookie()).toBeUndefined();
  });
});
