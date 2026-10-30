import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import LocaleError from './error';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.root);

describe('LocaleError', () => {
  it('says what happened in the page language, with focus on the heading', async () => {
    const { container } = renderInSubtree(
      <main id="main-content" tabIndex={-1}>
        <LocaleError error={new Error('boom')} retry={() => {}} />
      </main>,
      { locale: 'el' },
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Παρουσιάστηκε σφάλμα' })).toHaveFocus();
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('retries, leaving focus on the main content rather than a removed button', async () => {
    const retry = vi.fn();
    renderInSubtree(
      <main id="main-content" tabIndex={-1}>
        <LocaleError error={new Error('boom')} retry={retry} />
      </main>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
