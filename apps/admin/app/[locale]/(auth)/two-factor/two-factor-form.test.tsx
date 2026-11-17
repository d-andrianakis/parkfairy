import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { authClient } from '@/lib/auth-client';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';

import { TwoFactorForm } from './two-factor-form';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.auth);

vi.mock('@/lib/auth-client', () => ({
  authClient: { twoFactor: { verifyTotp: vi.fn(), verifyBackupCode: vi.fn() } },
}));
const verifyTotp = vi.mocked(authClient.twoFactor.verifyTotp);
const verifyBackupCode = vi.mocked(authClient.twoFactor.verifyBackupCode);

beforeEach(() => {
  verifyTotp.mockReset();
  verifyBackupCode.mockReset();
});

describe('staff TwoFactorForm', () => {
  it('refuses a code that is not six digits, in words, without asking the server', async () => {
    const { container } = renderInSubtree(<TwoFactorForm returnTo="/listings" />);
    await userEvent.type(screen.getByLabelText('Authentication code'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(screen.getByLabelText('Authentication code')).toHaveAccessibleDescription(
      'Enter the 6-digit code',
    );
    expect(verifyTotp).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('finishes at the page asked for', async () => {
    verifyTotp.mockResolvedValue({ data: {}, error: null } as never);
    renderInSubtree(<TwoFactorForm returnTo="/audit" />);
    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/audit'));
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('says in words that a code is wrong, and how long a lockout lasts', async () => {
    verifyTotp
      .mockResolvedValueOnce({ data: null, error: { code: 'INVALID_CODE', status: 401 } } as never)
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'ACCOUNT_TEMPORARILY_LOCKED', status: 429 },
      } as never);
    renderInSubtree(<TwoFactorForm returnTo="/listings" />);
    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Try again in 15 minutes'),
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('takes a backup code instead, and moves the focus to its field', async () => {
    verifyBackupCode.mockResolvedValue({ data: {}, error: null } as never);
    renderInSubtree(<TwoFactorForm returnTo="/listings" />);
    await userEvent.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    await waitFor(() => expect(screen.getByLabelText('Backup code')).toHaveFocus());
    await userEvent.type(screen.getByLabelText('Backup code'), 'abcd-efgh');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(verifyBackupCode).toHaveBeenCalledWith({ code: 'abcd-efgh' });
    expect(verifyTotp).not.toHaveBeenCalled();
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/listings'));
  });

  it('refuses a wrong backup code in words, and stays', async () => {
    verifyBackupCode.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_BACKUP_CODE', status: 401 },
    } as never);
    renderInSubtree(<TwoFactorForm returnTo="/listings" />);
    await userEvent.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    await userEvent.type(screen.getByLabelText('Backup code'), 'wrong-code');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'not valid or has already been used',
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('refuses an empty backup code, and goes back to the authenticator’s field with the focus', async () => {
    const { container } = renderInSubtree(<TwoFactorForm returnTo="/listings" />);
    await userEvent.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(screen.getByLabelText('Backup code')).toHaveAccessibleDescription(
      /Enter one of your backup codes/,
    );
    expect(verifyBackupCode).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
    await userEvent.click(
      screen.getByRole('button', { name: 'Use your authenticator app instead' }),
    );
    await waitFor(() => expect(screen.getByLabelText('Authentication code')).toHaveFocus());
  });

  it('reads in Greek', async () => {
    renderInSubtree(<TwoFactorForm returnTo="/listings" />, { locale: 'el' });
    expect(screen.getByLabelText('Κωδικός ελέγχου ταυτότητας')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Επαλήθευση' })).toBeInTheDocument();
  });
});
