import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GlobalErrorScreen } from './global-error-screen';

describe('GlobalErrorScreen', () => {
  it('speaks the page language without the layout’s message provider, at once', async () => {
    const { container } = render(
      <main>
        <GlobalErrorScreen locale="el" retry={() => {}} />
      </main>,
    );
    // Rendered at once (no catalog to fetch), with focus on the heading.
    expect(screen.getByRole('heading', { level: 1, name: 'Παρουσιάστηκε σφάλμα' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Δοκιμάστε ξανά' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('retries', async () => {
    const retry = vi.fn();
    render(<GlobalErrorScreen locale="en" retry={retry} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
