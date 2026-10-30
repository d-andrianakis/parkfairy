import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme } from '@/lib/theme';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { ThemeToggle } from './theme-toggle';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.root);

/** The stand-in button is replaced by the real (Radix) trigger once the menu chunk loads. */
async function menuLoaded(name: string) {
  await waitFor(() =>
    expect(screen.getByRole('button', { name })).toHaveAttribute(
      'data-slot',
      'dropdown-menu-trigger',
    ),
  );
  return screen.getByRole('button', { name });
}

describe('ThemeToggle', () => {
  afterEach(() => applyTheme('system'));

  it('is a named menu button in the page language', async () => {
    const { container } = renderInSubtree(<ThemeToggle initialTheme="system" />, {
      locale: 'el',
    });
    const trigger = screen.getByRole('button', { name: 'Θέμα' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expectNoAxeViolations(container);
  });

  it('opens on a key press made before the menu loaded, on the first option', async () => {
    renderInSubtree(<ThemeToggle initialTheme="dark" />, { locale: 'el' });
    const trigger = screen.getByRole('button', { name: 'Θέμα' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' }); // synchronously, before the chunk resolves

    const menu = await screen.findByRole('menu', { name: 'Θέμα' });
    expect(menu).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('menuitemradio', { name: 'Ανοιχτόχρωμο' })).toHaveFocus(),
    );
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Ανοιχτόχρωμο',
      'Σκουρόχρωμο',
      'Προεπιλογή συστήματος',
    ]);
    expect(screen.getByRole('menuitemradio', { name: 'Σκουρόχρωμο' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // The open menu is portalled to <body>. (aria-hidden-focus needs a real browser: theme.smoke.ts.)
    await expectNoAxeViolations(document.body);
  });

  it('keeps focus on the button when the menu loads, then behaves as a Radix menu', async () => {
    const user = userEvent.setup();
    renderInSubtree(<ThemeToggle initialTheme="system" />);
    await user.tab();

    const trigger = await menuLoaded('Theme');
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus());

    // Escape closes without changing anything and returns to the button.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Theme' })).toHaveFocus());
    expect(document.documentElement.className).toBe('');
    expect(document.cookie).not.toContain('theme=');
  });

  it('applies and remembers the chosen theme', async () => {
    const user = userEvent.setup();
    renderInSubtree(<ThemeToggle initialTheme="system" />);

    // A press before the menu has loaded still opens it. (Synchronous events: user-event
    // would keep targeting the stand-in after it is swapped out, which browsers don't.)
    const standIn = screen.getByRole('button', { name: 'Theme' });
    fireEvent.pointerEnter(standIn);
    fireEvent.pointerDown(standIn, { button: 0 });
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(document.cookie).toContain('theme=dark');
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Theme' })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Theme' }));
    expect(await screen.findByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
