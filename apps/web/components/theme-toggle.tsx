'use client';

import { Button } from '@parkfairy/ui/components/button';
import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ComponentType } from 'react';
import { applyTheme, type Theme } from '@/lib/theme';
import type { MenuStart, ThemeMenuProps } from './theme-menu';

let menuChunk: Promise<typeof import('./theme-menu')> | undefined;
function loadMenu() {
  menuChunk ??= import('./theme-menu').catch((error: unknown) => {
    menuChunk = undefined; // let the next hover or tap retry
    throw error;
  });
  return menuChunk;
}

type LoadedMenu = { Menu: ComponentType<ThemeMenuProps>; start: MenuStart };

/**
 * Light / dark / system menu. The server already rendered the saved choice, and "system"
 * needs no JavaScript, so the menu itself (shadcn DropdownMenu) loads only when the reader
 * points at, focuses or taps the button. A press made before it arrives is replayed.
 */
export function ThemeToggle({ initialTheme }: { initialTheme: Theme }) {
  const t = useTranslations('Theme');
  const [theme, setTheme] = useState(initialTheme);
  const [menu, setMenu] = useState<LoadedMenu>();
  const standIn = useRef<HTMLButtonElement>(null);
  const openRequest = useRef<'pointer' | 'keyboard'>(undefined);

  function choose(value: Theme) {
    setTheme(value);
    applyTheme(value);
  }

  function prepare() {
    void loadMenu()
      .then(({ ThemeMenu }) => {
        const start: MenuStart = openRequest.current
          ? `open-${openRequest.current}`
          : document.activeElement === standIn.current
            ? 'focused'
            : 'idle';
        setMenu((current) => current ?? { Menu: ThemeMenu, start });
      })
      .catch(() => {}); // the stand-in stays; a later interaction retries
  }

  function requestOpen(kind: 'pointer' | 'keyboard') {
    openRequest.current = kind;
    // The chunk may have arrived but not rendered yet: upgrade the pending start.
    setMenu((current) => current && { ...current, start: `open-${kind}` });
    prepare();
  }

  const icons = (
    <>
      {/* The theme in effect, which for "system" is the OS's (pure CSS, no hydration flash). */}
      <Sun className="dark:hidden" aria-hidden />
      <Moon className="hidden dark:block" aria-hidden />
    </>
  );

  if (menu) {
    const trigger = (
      <Button variant="ghost" size="icon-sm" aria-label={t('label')}>
        {icons}
      </Button>
    );
    return <menu.Menu trigger={trigger} theme={theme} onThemeChange={choose} start={menu.start} />;
  }

  return (
    <Button
      ref={standIn}
      variant="ghost"
      size="icon-sm"
      aria-label={t('label')}
      aria-haspopup="menu"
      aria-expanded={false}
      onPointerEnter={prepare}
      onFocus={prepare}
      onPointerDown={(event) => {
        if (event.button === 0 && !event.ctrlKey) requestOpen('pointer');
      }}
      onKeyDown={(event) => {
        if (!['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        requestOpen('keyboard');
      }}
    >
      {icons}
    </Button>
  );
}
