import type { AdminUser } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadUser } from '@/lib/admin.server';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';
import { notFoundMock } from '@/test/server-mocks';

import UserPage from './[id]/page';
import UsersPage from './page';

vi.mock('@/lib/admin.server', () => ({ loadUser: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn() }));
vi.mock('@/lib/server-env', () => ({
  parseServerEnv: () => ({ BETTER_AUTH_URL: 'http://localhost:3000' }),
}));
vi.mock('@/lib/admin-client', () => ({
  lookUpUser: vi.fn(),
  removeTwoFactor: vi.fn(),
  suspendUser: vi.fn(),
  reinstateUser: vi.fn(),
  useAdminError: () => () => 'error',
}));
vi.mock('next-intl/server', async () => (await import('@/test/server-mocks')).serverIntl());
vi.mock('next/navigation', async () => ({
  notFound: (await import('@/test/server-mocks')).notFoundMock,
}));

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const staff = { session: { user: { name: 'Staff Sam' } }, standing: 'staff' as const };
const params = (locale: 'en' | 'el' = 'en', id = ID) => Promise.resolve({ locale, id });
const show = async (page: Promise<React.ReactNode>, locale: 'en' | 'el' = 'en') =>
  renderWithProviders(<>{await page}</>, { locale });

const account = (over: Partial<AdminUser> = {}): AdminUser => ({
  id: ID,
  name: 'Ελένη Παπά',
  email: 'eleni@example.gr',
  role: 'user',
  locale: 'el',
  emailVerified: true,
  twoFactorEnabled: true,
  createdAt: '2026-10-01T08:00:00.000Z',
  own: false,
  canRemoveTwoFactor: true,
  suspended: false,
  canSuspend: true,
  canReinstate: false,
  liveListings: 0,
  ...over,
});

beforeEach(() => {
  vi.mocked(loadUser).mockReset();
  vi.mocked(requireSession).mockReset();
  vi.mocked(requireSession).mockResolvedValue(staff as never);
  notFoundMock.mockClear();
});

describe('the accounts page', () => {
  it('asks for sign-in with its own address, and offers one whole address and nothing to browse', async () => {
    const { container } = await show(UsersPage({ params: params() }));
    expect(requireSession).toHaveBeenCalledWith('/users');
    expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('shows someone who is not staff why, and no form', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      session: { user: {} },
      standing: 'not-staff',
    } as never);
    await show(UsersPage({ params: params() }));
    expect(screen.queryByLabelText('Email address')).toBeNull();
    expect(screen.getByText('This account is not staff')).toBeInTheDocument();
  });

  it('reads in Greek, axe-clean', async () => {
    const { container } = await show(UsersPage({ params: params('el') }), 'el');
    expect(screen.getByRole('heading', { level: 1, name: 'Λογαριασμοί' })).toBeInTheDocument();
    expect(screen.getByLabelText('Διεύθυνση email')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe('an account', () => {
  it('shows who it is and how it is secured, with the removal on offer', async () => {
    vi.mocked(loadUser).mockResolvedValue(account());
    const { container } = await show(UserPage({ params: params() }));
    expect(requireSession).toHaveBeenCalledWith(`/users/${ID}`);
    expect(loadUser).toHaveBeenCalledWith(ID);
    expect(screen.getByRole('heading', { level: 1, name: 'Ελένη Παπά' })).toBeInTheDocument();
    expect(screen.getByText('eleni@example.gr')).toBeInTheDocument();
    expect(screen.getByText('Standard account')).toBeInTheDocument();
    // The language in its own words, marked as that language.
    expect(screen.getByText('Ελληνικά')).toHaveAttribute('lang', 'el');
    // A Greek name on an English page is marked Greek, and isolated from the text around it.
    const name = screen.getByRole('heading', { level: 1 });
    expect(name.querySelector('bdi span[lang="el"]')).toHaveTextContent('Ελένη Παπά');
    expect(screen.getByText('eleni@example.gr').tagName).toBe('BDI');
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByRole('time')).toHaveAttribute('datetime', '2026-10-01T08:00:00.000Z');
    expect(
      screen.getByRole('button', { name: 'Remove two-factor authentication…' }),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('offers no removal on staff, and says why', async () => {
    vi.mocked(loadUser).mockResolvedValue(account({ role: 'admin', canRemoveTwoFactor: false }));
    await show(UserPage({ params: params() }));
    expect(screen.getAllByText('Staff account').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('note')[0]).toHaveTextContent('Staff recover their own');
    expect(screen.queryByRole('button', { name: /Remove two-factor/ })).toBeNull();
  });

  it('offers no removal on the reader’s own account', async () => {
    vi.mocked(loadUser).mockResolvedValue(
      account({ own: true, role: 'admin', canRemoveTwoFactor: false }),
    );
    await show(UserPage({ params: params() }));
    expect(screen.getAllByRole('note')[0]).toHaveTextContent('your own account');
  });

  it('offers none where there is nothing to remove', async () => {
    vi.mocked(loadUser).mockResolvedValue(
      account({ twoFactorEnabled: false, canRemoveTwoFactor: false }),
    );
    await show(UserPage({ params: params() }));
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getAllByRole('note')[0]).toHaveTextContent('has no two-factor authentication');
  });

  it.each([
    ['not-staff', 'This account is not staff'],
    ['no-second-factor', 'Turn on two-factor first'],
  ] as const)('shows %s staff why, and asks the API for nothing', async (standing, title) => {
    vi.mocked(requireSession).mockResolvedValue({ session: { user: {} }, standing } as never);
    await show(UserPage({ params: params() }));
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(loadUser).not.toHaveBeenCalled();
    expect(screen.queryByText('eleni@example.gr')).toBeNull();
  });

  it('shows whether the account is active, with the suspension on offer and the listings it owns', async () => {
    vi.mocked(loadUser).mockResolvedValue(account({ liveListings: 2 }));
    const { container } = await show(UserPage({ params: params() }));
    expect(screen.getByText('Account status').nextElementSibling).toHaveTextContent('Active');
    expect(screen.getByRole('heading', { level: 2, name: 'Suspension' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend this account…' })).toBeInTheDocument();
    expect(screen.getByText(/primary owner of 2 live listings/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('marks a suspended account in words, and offers its reinstatement', async () => {
    vi.mocked(loadUser).mockResolvedValue(
      account({ suspended: true, canSuspend: false, canReinstate: true }),
    );
    await show(UserPage({ params: params() }));
    expect(screen.getByText('Account status').nextElementSibling).toHaveTextContent('Suspended');
    expect(screen.getByRole('button', { name: 'Reinstate this account…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend this account…' })).toBeNull();
  });

  it('offers staff no suspension, and says why', async () => {
    vi.mocked(loadUser).mockResolvedValue(
      account({ role: 'admin', canSuspend: false, canRemoveTwoFactor: false }),
    );
    await show(UserPage({ params: params() }));
    expect(
      screen.getByText('This is a staff account. Staff accounts are not suspended here.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend this account…' })).toBeNull();
  });

  it('is a not-found page for an id that is not one, without asking the API', async () => {
    await expect(UserPage({ params: params('en', 'not-an-id') })).rejects.toThrow();
    expect(notFoundMock).toHaveBeenCalled();
    expect(loadUser).not.toHaveBeenCalled();
  });

  it('is a not-found page for an account that is gone', async () => {
    vi.mocked(loadUser).mockResolvedValue('not-found');
    await expect(UserPage({ params: params() })).rejects.toThrow();
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('says in words when the API is unavailable, with a way back', async () => {
    vi.mocked(loadUser).mockResolvedValue('unavailable');
    await show(UserPage({ params: params() }));
    expect(screen.getByRole('link', { name: 'Back to accounts' })).toHaveAttribute(
      'href',
      '/en/users',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads in Greek, axe-clean', async () => {
    vi.mocked(loadUser).mockResolvedValue(account());
    const { container } = await show(UserPage({ params: params('el') }), 'el');
    expect(screen.getByText('Λογαριασμός χρήστη')).toBeInTheDocument();
    // Greek times are on the 24-hour clock.
    expect(screen.getByRole('time').textContent).not.toMatch(/π\.μ\.|μ\.μ\./);
    expect(screen.getByRole('time').textContent).toMatch(/11:00/);
    expect(screen.getAllByText('Ενεργός')).toHaveLength(2);
    await expectNoAxeViolations(container);
  });
});
