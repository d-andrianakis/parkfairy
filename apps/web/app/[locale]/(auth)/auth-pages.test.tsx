import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';
import SignInPage from './sign-in/page';
import SignUpPage from './sign-up/page';

vi.mock('@/lib/session', () => ({ getSession: vi.fn(() => Promise.resolve(null)) }));
vi.mock('next-intl/server', async () => {
  const [{ createTranslator }, en] = await Promise.all([
    import('next-intl'),
    import('@/messages/en.json'),
  ]);
  return {
    getTranslations: ({ namespace }: { namespace: string }) =>
      Promise.resolve(
        createTranslator({ locale: 'en', messages: en.default, namespace: namespace as never }),
      ),
  };
});
// The forms themselves have their own tests; here only the links around them matter.
vi.mock('./sign-in/sign-in-form', () => ({ SignInForm: () => null }));
vi.mock('./sign-up/sign-up-form', () => ({ SignUpForm: () => null }));

const STAY = '/parking/ermou-garage?startDate=2026-12-10&startTime=10%3A00';
const params = Promise.resolve({ locale: 'en' });
const nextOf = (name: string) =>
  new URL(
    screen.getByRole('link', { name }).getAttribute('href') ?? '',
    'http://x',
  ).searchParams.get('next');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('signing in and up with somewhere to go back to (3.1)', () => {
  it('keeps the stay on the way from signing in to creating an account', async () => {
    renderWithProviders(
      await SignInPage({ params, searchParams: Promise.resolve({ next: STAY }) }),
    );
    expect(nextOf('Create an account')).toBe(STAY);
  });

  it('and back again, from creating an account to signing in', async () => {
    renderWithProviders(
      await SignUpPage({ params, searchParams: Promise.resolve({ next: STAY }) }),
    );
    expect(nextOf('Sign in')).toBe(STAY);
  });

  it('adds nothing when there was nowhere to go back to', async () => {
    renderWithProviders(await SignInPage({ params, searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/en/sign-up',
    );
  });

  it('never carries another site along', async () => {
    renderWithProviders(
      await SignUpPage({ params, searchParams: Promise.resolve({ next: '//evil.example' }) }),
    );
    expect(nextOf('Sign in')).toBe('/account');
  });

  it('sends someone already signed in where they were going', async () => {
    vi.mocked(getSession).mockResolvedValueOnce({ user: { id: 'u' } } as never);
    await SignUpPage({ params, searchParams: Promise.resolve({ next: STAY }) }).catch(() => null);
    expect(redirect).toHaveBeenCalledWith({ href: STAY, locale: 'en' });
  });
});
