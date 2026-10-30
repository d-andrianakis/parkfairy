import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { routerMock } from '@/test/navigation-mock';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { TwoFactorForm } from './two-factor-form';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.auth);

vi.mock('@/lib/auth-client', () => ({ authClient: { twoFactor: { verifyTotp: vi.fn() } } }));
const verifyTotp = vi.mocked(authClient.twoFactor.verifyTotp);

async function enter(code: string) {
  await userEvent.type(screen.getByLabelText('Authentication code'), code);
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('TwoFactorForm', () => {
  beforeEach(() => {
    verifyTotp.mockReset(); // braces: a returned function would run as a cleanup hook
  });

  it('asks for a 6-digit code before calling the server', async () => {
    const { container } = renderInSubtree(<TwoFactorForm />);
    expect(screen.getByLabelText('Authentication code')).toHaveAttribute(
      'autocomplete',
      'one-time-code',
    );

    await enter('12ab');

    expect(screen.getByLabelText('Authentication code')).toHaveAccessibleDescription(
      'Enter the 6-digit code',
    );
    expect(verifyTotp).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('announces a failed submit when Enter is pressed in the (already focused) field', async () => {
    renderInSubtree(<TwoFactorForm />, { locale: 'el' });
    const code = screen.getByLabelText('Κωδικός ελέγχου ταυτότητας');
    await userEvent.type(code, '12ab{Enter}');

    // Focus never moves (it is already on the only field), so a status message speaks up.
    expect(code).toHaveFocus();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('1 πεδίο χρειάζεται διόρθωση'),
    );
    expect(verifyTotp).not.toHaveBeenCalled();
  });

  it('keeps the button focusable while verifying, and ignores repeat submits', async () => {
    let finish = () => {};
    verifyTotp.mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ data: {}, error: null } as never))),
    );
    renderInSubtree(<TwoFactorForm />);
    await enter('123456');

    const button = screen.getByRole('button', { name: 'Verifying…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(verifyTotp).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/account'));
  });

  it('reports an invalid code', async () => {
    verifyTotp.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_CODE', status: 401 },
    } as never);
    renderInSubtree(<TwoFactorForm />);
    await enter('123456');
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid.');
  });

  it('continues to the account once verified', async () => {
    verifyTotp.mockResolvedValue({ data: {}, error: null } as never);
    renderInSubtree(<TwoFactorForm />);
    await enter('123456');
    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    expect(routerMock.replace).toHaveBeenCalledWith('/account');
  });

  it('empties the status before announcing a repeated failure, so it is read again', async () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      renderInSubtree(<TwoFactorForm />);
      const code = screen.getByLabelText('Authentication code');
      const status = screen.getByRole('status');

      await userEvent.type(code, '12ab{Enter}');
      act(() => frames.shift()?.(0));
      expect(status).toHaveTextContent('1 field needs your attention');

      await userEvent.type(code, '{Enter}');
      expect(status).toBeEmptyDOMElement(); // cleared first…
      act(() => frames.shift()?.(0));
      expect(status).toHaveTextContent('1 field needs your attention'); // …then set again
    } finally {
      raf.mockRestore();
    }
  });
});
