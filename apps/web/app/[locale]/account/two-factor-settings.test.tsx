import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { routerMock } from '@/test/navigation-mock';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { TwoFactorSettings } from './two-factor-settings';

// Only the catalog namespaces this subtree ships to the browser.
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.account);

vi.mock('@/lib/auth-client', () => ({
  authClient: { twoFactor: { enable: vi.fn(), disable: vi.fn(), verifyTotp: vi.fn() } },
}));
const enable = vi.mocked(authClient.twoFactor.enable);
const disable = vi.mocked(authClient.twoFactor.disable);
const verifyTotp = vi.mocked(authClient.twoFactor.verifyTotp);

const EMAIL = 'demo@example.com';
const SETUP = {
  method: 'totp',
  totpURI: 'otpauth://totp/Parkfairy:demo%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Parkfairy',
  backupCodes: ['aaaaa-11111', 'bbbbb-22222', 'ccccc-33333'],
};

// The steps load lazily, so wait for the password field first.
async function confirmPassword(password: string, submit = 'Continue') {
  await screen.findByLabelText('Password');
  if (password) await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: submit }));
}

describe('TwoFactorSettings', () => {
  beforeEach(() => {
    enable.mockReset();
    disable.mockReset();
    verifyTotp.mockReset();
  });

  it('shows the current state and asks for the password before setting up', async () => {
    const { container } = renderInSubtree(<TwoFactorSettings enabled={false} email={EMAIL} />);
    expect(screen.getByTestId('two-factor-status')).toHaveTextContent('Off.');

    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));

    const heading = await screen.findByRole('heading', { name: 'Confirm it’s you' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    await expectNoAxeViolations(container);
  });

  it('requires a password before calling the server', async () => {
    renderInSubtree(<TwoFactorSettings enabled={false} email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));
    await confirmPassword('');

    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Enter your password');
    expect(enable).not.toHaveBeenCalled();
  });

  it('reports a wrong password', async () => {
    enable.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_PASSWORD', status: 400 },
    } as never);
    renderInSubtree(<TwoFactorSettings enabled={false} email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));
    await confirmPassword('wrong-password');

    expect(await screen.findByRole('alert')).toHaveTextContent('That password is incorrect.');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('enrols: QR code and typed key, a first code, then backup codes shown once', async () => {
    enable.mockResolvedValue({ data: SETUP, error: null } as never);
    verifyTotp.mockResolvedValue({ data: { token: 't' }, error: null } as never);
    const { container } = renderInSubtree(<TwoFactorSettings enabled={false} email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));
    await confirmPassword('correct-password');

    expect(enable).toHaveBeenCalledWith({ password: 'correct-password', method: 'totp' });
    expect(
      await screen.findByRole('heading', { name: 'Add Parkfairy to your authenticator app' }),
    ).toHaveFocus();
    expect(
      screen.getByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('two-factor-key')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    await expectNoAxeViolations(container);

    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    expect(await screen.findByRole('heading', { name: 'Save your backup codes' })).toHaveFocus();
    const codes = within(screen.getByRole('list', { name: 'Backup codes' })).getAllByRole(
      'listitem',
    );
    expect(codes.map((item) => item.textContent)).toEqual(SETUP.backupCodes);
    expect(routerMock.refresh).toHaveBeenCalled();
    await expectNoAxeViolations(container);

    await userEvent.click(screen.getByRole('button', { name: 'I’ve saved them' }));

    expect(screen.getByTestId('two-factor-status')).toHaveTextContent('On.');
    expect(screen.queryByText('aaaaa-11111')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Turn off two-factor authentication' }),
      ).toHaveFocus(),
    );
  });

  it('checks the code format, then reports a wrong code from the server', async () => {
    enable.mockResolvedValue({ data: SETUP, error: null } as never);
    verifyTotp.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_CODE', status: 401 },
    } as never);
    renderInSubtree(<TwoFactorSettings enabled={false} email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));
    await confirmPassword('correct-password');

    const code = await screen.findByLabelText('Authentication code');
    await userEvent.type(code, '12ab');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(code).toHaveAccessibleDescription('Enter the 6-digit code');
    expect(verifyTotp).not.toHaveBeenCalled();

    await userEvent.clear(code);
    await userEvent.type(code, '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid.');
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it('cancelling returns to the overview with focus on the button', async () => {
    renderInSubtree(<TwoFactorSettings enabled={false} email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Set up two-factor authentication' }),
      ).toHaveFocus(),
    );
    expect(enable).not.toHaveBeenCalled();
  });

  it('turns two-factor off after the password is confirmed', async () => {
    disable.mockResolvedValue({ data: { status: true }, error: null } as never);
    renderInSubtree(<TwoFactorSettings enabled email={EMAIL} />);
    expect(screen.getByTestId('two-factor-status')).toHaveTextContent('On.');

    await userEvent.click(
      screen.getByRole('button', { name: 'Turn off two-factor authentication' }),
    );
    await confirmPassword('correct-password', 'Turn off two-factor authentication');

    expect(disable).toHaveBeenCalledWith({ password: 'correct-password' });
    expect(screen.getByTestId('two-factor-status')).toHaveTextContent('Off.');
    expect(routerMock.refresh).toHaveBeenCalled();
    const setUp = screen.getByRole('button', { name: 'Set up two-factor authentication' });
    await waitFor(() => expect(setUp).toHaveFocus());
    expect(setUp).toHaveAccessibleDescription('Off. Signing in needs only your password.');
  });

  it('keeps the submit button focusable while checking, and ignores repeats', async () => {
    let finish = () => {};
    enable.mockImplementation(
      () =>
        new Promise((resolve) => (finish = () => resolve({ data: SETUP, error: null } as never))),
    );
    renderInSubtree(<TwoFactorSettings enabled={false} email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));
    await confirmPassword('correct-password');

    const button = screen.getByRole('button', { name: 'Checking…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await userEvent.click(button);
    expect(enable).toHaveBeenCalledTimes(1);
    finish();
    expect(
      await screen.findByRole('heading', { name: 'Add Parkfairy to your authenticator app' }),
    ).toBeInTheDocument();
  });

  it('speaks Greek', async () => {
    renderInSubtree(<TwoFactorSettings enabled={false} email={EMAIL} />, { locale: 'el' });
    expect(screen.getByTestId('two-factor-status')).toHaveTextContent('Ανενεργός.');
    await userEvent.click(
      screen.getByRole('button', { name: 'Ρύθμιση ελέγχου ταυτότητας δύο παραγόντων' }),
    );
    const heading = await screen.findByRole('heading', { name: 'Επιβεβαιώστε ότι είστε εσείς' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByLabelText('Κωδικός πρόσβασης')).toBeInTheDocument();
  });

  it('keeps two-factor on when the password is wrong while turning it off', async () => {
    disable.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_PASSWORD', status: 400 },
    } as never);
    renderInSubtree(<TwoFactorSettings enabled email={EMAIL} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Turn off two-factor authentication' }),
    );
    await confirmPassword('wrong-password', 'Turn off two-factor authentication');

    expect(await screen.findByRole('alert')).toHaveTextContent('That password is incorrect.');
    expect(routerMock.refresh).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('two-factor-status')).toHaveTextContent('On.');
  });

  it('cancelling at the QR step leaves two-factor off, with focus on Set up', async () => {
    enable.mockResolvedValue({ data: SETUP, error: null } as never);
    renderInSubtree(<TwoFactorSettings enabled={false} email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));
    await confirmPassword('correct-password');
    await screen.findByRole('img', { name: 'QR code for your authenticator app' });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('two-factor-status')).toHaveTextContent('Off.');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Set up two-factor authentication' }),
      ).toHaveFocus(),
    );
    expect(verifyTotp).not.toHaveBeenCalled();
  });

  it('tells password managers which login the password is for', async () => {
    const { container } = renderInSubtree(<TwoFactorSettings enabled={false} email={EMAIL} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up two-factor authentication' }));
    await screen.findByLabelText('Password');
    expect(container.querySelector('input[autocomplete=username]')).toHaveValue(EMAIL);
  });
});
