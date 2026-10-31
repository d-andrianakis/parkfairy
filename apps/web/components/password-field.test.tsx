import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { PasswordField, usePasswordReveal } from './password-field';

function Field({ error }: { error?: string }) {
  const reveal = usePasswordReveal();
  return (
    <>
      <PasswordField
        id="password"
        label="Password"
        hint="At least 10 characters."
        error={error}
        reveal={reveal}
      />
      <button type="button" onClick={reveal.hide}>
        Validation passed
      </button>
    </>
  );
}

/** The markup a browser has before the page hydrates. */
const serverRendered = (
  <NextIntlClientProvider
    locale="en"
    messages={{ Forms: { showPassword: 'Show password' } }}
    timeZone="Europe/Athens"
  >
    <Field />
  </NextIntlClientProvider>
);

describe('PasswordField', () => {
  it('starts hidden and shows what was typed on request', async () => {
    const { container } = renderWithProviders(<Field />);
    const input = screen.getByLabelText('Password');
    const show = screen.getByRole('button', { name: 'Show password' });
    expect(input).toHaveAttribute('type', 'password');
    expect(show).toHaveAttribute('aria-pressed', 'false');

    await userEvent.type(input, 'correct horse');
    await userEvent.click(show);

    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('correct horse');
    expect(show).toHaveAttribute('aria-pressed', 'true');
    expect(show).toHaveFocus();
    await expectNoAxeViolations(container);

    await userEvent.click(show);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('is named in the page language', () => {
    renderWithProviders(<Field />, { locale: 'el' });
    expect(screen.getByRole('button', { name: 'Εμφάνιση κωδικού πρόσβασης' })).toBeInTheDocument();
  });

  it('works from the keyboard, right after the input', async () => {
    renderWithProviders(<Field />);
    await userEvent.tab();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  });

  it('keeps the hint and error wired to the input', () => {
    renderWithProviders(<Field error="Too short" />);
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'At least 10 characters. Too short',
    );
  });

  it('keeps a shown password away from spell checkers', async () => {
    renderWithProviders(<Field />);
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('spellcheck', 'false');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocapitalize', 'none');
  });

  it('does not submit the form', async () => {
    let submitted = false;
    renderWithProviders(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <Field />
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(submitted).toBe(false);
  });

  it('hides again when the form says validation passed', async () => {
    renderWithProviders(<Field />);
    const show = screen.getByRole('button', { name: 'Show password' });
    await userEvent.click(show);

    await userEvent.click(screen.getByRole('button', { name: 'Validation passed' }));

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(show).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders no button on the server, where it could not work yet', () => {
    const html = renderToString(serverRendered);
    expect(html).toContain('type="password"');
    expect(html).not.toContain('Show password');
  });

  it('keeps the same input through hydration, so nobody loses their place', async () => {
    // Replacing it would drop the focus and whatever is typed before the page is interactive.
    const host = document.body.appendChild(document.createElement('div'));
    host.innerHTML = renderToString(serverRendered);
    const input = host.querySelector('input') as HTMLInputElement;
    input.focus();

    const root = await act(() => Promise.resolve(hydrateRoot(host, serverRendered)));

    expect(host.querySelector('input')).toBe(input);
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
    act(() => root.unmount());
    host.remove();
  });
});
