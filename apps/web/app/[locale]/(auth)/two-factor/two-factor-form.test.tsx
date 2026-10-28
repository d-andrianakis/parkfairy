import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authClient } from '@/lib/auth-client';
import { routerMock } from '@/test/navigation-mock';
import { renderWithProviders } from '@/test/render';
import { TwoFactorForm } from './two-factor-form';

vi.mock('@/lib/auth-client', () => ({ authClient: { twoFactor: { verifyTotp: vi.fn() } } }));
const verifyTotp = vi.mocked(authClient.twoFactor.verifyTotp);

async function enter(code: string) {
  await userEvent.type(screen.getByLabelText('Authentication code'), code);
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('TwoFactorForm', () => {
  beforeEach(() => verifyTotp.mockReset());

  it('asks for a 6-digit code before calling the server', async () => {
    const { container } = renderWithProviders(<TwoFactorForm />);
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

  it('reports an invalid code', async () => {
    verifyTotp.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_CODE', status: 401 },
    } as never);
    renderWithProviders(<TwoFactorForm />);
    await enter('123456');
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not valid.');
  });

  it('continues to the account once verified', async () => {
    verifyTotp.mockResolvedValue({ data: {}, error: null } as never);
    renderWithProviders(<TwoFactorForm />);
    await enter('123456');
    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    expect(routerMock.replace).toHaveBeenCalledWith('/account');
  });
});
