'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@parkfairy/ui/components/dropdown-menu';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement } from 'react';
import { isTheme, THEMES, type Theme } from '@/lib/theme';

const ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/** What the reader did to the stand-in trigger before this chunk arrived. */
export type MenuStart = 'idle' | 'focused' | 'open-pointer' | 'open-keyboard';

export interface ThemeMenuProps {
  trigger: ReactElement;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  start: MenuStart;
}

/**
 * The Radix menu behind the theme button, loaded on intent by ThemeToggle so its ~28 KiB
 * overlay stack stays off every first visit.
 */
export function ThemeMenu({ trigger, theme, onThemeChange, start }: ThemeMenuProps) {
  const t = useTranslations('Theme');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tookOver = useRef(false);

  // Take over from the stand-in this trigger replaced: keep focus where the reader left it,
  // and replay a press it got before this chunk arrived through Radix's own handlers (a key
  // press also puts Radix in keyboard mode, so the first option gets focus as usual).
  useEffect(() => {
    const button = triggerRef.current;
    if (!button || tookOver.current) return;
    tookOver.current = true; // once, also under StrictMode's double effects
    if (
      start === 'open-keyboard' ||
      (start === 'focused' && document.activeElement === document.body)
    ) {
      button.focus();
    }
    const init = { bubbles: true, cancelable: true };
    if (start === 'open-keyboard') {
      button.dispatchEvent(new KeyboardEvent('keydown', { ...init, key: 'Enter' }));
    } else if (start === 'open-pointer') {
      button.dispatchEvent(new PointerEvent('pointerdown', { ...init, button: 0 }));
    }
  }, [start]);

  return (
    // Non-modal, like the WAI-ARIA menu button pattern: a modal menu sets aria-hidden on the
    // rest of the page while its links stay focusable (axe: aria-hidden-focus).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild ref={triggerRef}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isTheme(value)) onThemeChange(value);
          }}
        >
          {THEMES.map((value) => {
            const Icon = ICONS[value];
            return (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon aria-hidden />
                {t(value)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
