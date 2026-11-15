import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';
import SignInPage from './sign-in/page';
import TwoFactorPage from './two-factor/page';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
vi.mock('next-intl/server', async () => (await import('@/test/server-mocks')).serverIntl());
// The forms are tested on their own; here only what the page hands them.
vi.mock('./sign-in/sign-in-form', () => ({
  SignInForm: ({ returnTo }: { returnTo: string }) => <p data-testid="sign-in">{returnTo}</p>,
}));
vi.mock('./two-factor/two-factor-form', () => ({
  TwoFactorForm: ({ returnTo }: { returnTo: string }) => <p data-testid="two-factor">{returnTo}</p>,
}));

const params = Promise.resolve({ locale: 'en' as const });
const search = (next?: string | string[]) => Promise.resolve(next === undefined ? {} : { next });
const show = async (page: Promise<React.ReactNode>) => renderWithProviders(<>{await page}</>);

beforeEach(() => {
  vi.mocked(getSession).mockReset();
  vi.mocked(redirect).mockReset();
});

describe('the staff sign-in page', () => {
  it('has one heading and carries the page asked for to the form', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await show(SignInPage({ params, searchParams: search('/audit?action=listing.approved') }));
    expect(screen.getByRole('heading', { level: 1, name: 'Staff sign-in' })).toBeInTheDocument();
    expect(screen.getByTestId('sign-in')).toHaveTextContent('/audit?action=listing.approved');
  });

  it.each([
    '//evil.example',
    'https://evil.example',
    '/\\evil.example',
    '/api/v1/admin/listings',
    ['/audit', '/other'],
    undefined,
  ])('sends to the queue, not to %j', async (next) => {
    vi.mocked(getSession).mockResolvedValue(null);
    await show(SignInPage({ params, searchParams: search(next) }));
    expect(screen.getByTestId('sign-in')).toHaveTextContent(/^\/listings$/);
  });

  it('sends someone already signed in on to the page asked for, or to the queue', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: {} } as never);
    await show(SignInPage({ params, searchParams: search('/audit') }));
    expect(redirect).toHaveBeenLastCalledWith({ href: '/audit', locale: 'en' });
    await show(SignInPage({ params, searchParams: search('//evil.example') }));
    expect(redirect).toHaveBeenLastCalledWith({ href: '/listings', locale: 'en' });
  });
});

describe('the second step’s page', () => {
  it('carries the page asked for to the form, and nothing hostile', async () => {
    await show(TwoFactorPage({ params, searchParams: search('/listings/abc') }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Two-factor verification' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('two-factor')).toHaveTextContent('/listings/abc');
    for (const next of ['//evil.example', 'https://evil.example', ['/a', '/b']]) {
      await show(TwoFactorPage({ params, searchParams: search(next) }));
      expect(screen.getAllByTestId('two-factor').at(-1)).toHaveTextContent(/^\/listings$/);
    }
  });
});
