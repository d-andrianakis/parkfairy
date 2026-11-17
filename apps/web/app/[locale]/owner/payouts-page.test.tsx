import type { OwnerPayouts } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PayoutsCard } from '@/components/owner/payouts-card';
import { loadOwnerPayouts } from '@/lib/owner.server';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';

import OwnerLayout from './layout';
import PayoutsPage, { generateMetadata } from './payouts/page';

vi.mock('@/lib/owner.server', () => ({ loadOwnerPayouts: vi.fn() }));
vi.mock('@/lib/session', () => ({
  requireSession: vi.fn(() => Promise.resolve()),
  getLayoutSession: vi.fn(() => Promise.resolve({ user: { id: 'u' } })),
}));
vi.mock('next-intl/server', async () => {
  const [{ createTranslator }, en, el] = await Promise.all([
    import('next-intl'),
    import('@/messages/en.json'),
    import('@/messages/el.json'),
  ]);
  const catalogs = { en: en.default, el: el.default };
  return {
    getTranslations: ({ locale, namespace }: { locale: 'en' | 'el'; namespace: string }) =>
      Promise.resolve(
        createTranslator({ locale, messages: catalogs[locale], namespace: namespace as never }),
      ),
  };
});

const renderInOwnerArea = async (page: ReactElement, locale: 'en' | 'el' = 'en') =>
  renderWithProviders(<>{await OwnerLayout({ children: page })}</>, { locale });

async function show(payouts: OwnerPayouts | null, link?: string, locale: 'en' | 'el' = 'en') {
  vi.mocked(loadOwnerPayouts).mockResolvedValue(payouts);
  return renderInOwnerArea(
    await PayoutsPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve(link ? { link } : {}),
    }),
    locale,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the payouts page (decision #48)', () => {
  it('needs the owner signed in, and is named for what it is', async () => {
    await show({ available: true, status: 'none' });
    expect(requireSession).toHaveBeenCalledWith('/owner/payouts');
    const meta = await generateMetadata({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    expect(meta.title).toBe('Payouts');
  });

  it.each([
    ['none', 'You haven’t set up payouts yet.', 'Set up payouts with Stripe'],
    // What's owed waits for the account (#52), bookings too, and the owner is told.
    [
      'restricted',
      'Stripe can’t pay you at the moment. Until it can, drivers can’t book your parking, and any payouts due to you wait.',
      'Continue with Stripe',
    ],
    ['active', 'Payouts are set up.', 'Open your Stripe dashboard'],
  ] as const)('says where %s payouts stand, with the way on', async (status, text, button) => {
    const { container } = await show({ available: true, status });
    expect(screen.getByRole('heading', { level: 1, name: 'Getting paid' })).toBeVisible();
    expect(screen.getByText(new RegExp(`^${text}`))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: button })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('offers nothing to press while Stripe checks', async () => {
    await show({ available: true, status: 'pending' });
    expect(screen.getByText(/^Stripe is checking your details/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says so, focused, when Stripe sends the owner back, in Greek too', async () => {
    await show({ available: true, status: 'restricted' }, 'expired', 'el');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Ο σύνδεσμος προς τη Stripe έληξε.',
      }),
    ).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Συνέχεια στη Stripe' })).toBeInTheDocument();
    // What waits meanwhile (#52), in Greek too.
    expect(
      screen.getByText(/^Η Stripe δεν μπορεί να σας πληρώσει προς το παρόν\. Μέχρι τότε,/),
    ).toBeInTheDocument();
  });

  it('says payouts can’t be set up where Stripe isn’t, and when the API can’t say', async () => {
    const none = await show({ available: false, status: 'none' }, 'returned');
    expect(screen.getByText('Payouts can’t be set up here yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // Nothing to welcome anyone back to.
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    none.unmount();
    await show(null);
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
  });

  it('ignores a made-up link value', async () => {
    await show({ available: true, status: 'none' }, 'elsewhere');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });
});

describe('the dashboard’s payouts card', () => {
  const card = async (payouts: OwnerPayouts | null) => {
    vi.mocked(loadOwnerPayouts).mockResolvedValue(payouts);
    return renderWithProviders(<>{await PayoutsCard({ locale: 'en', payouts })}</>);
  };

  it('points to setting payouts up until they are, and to them after', async () => {
    const first = await card({ available: true, status: 'none' });
    expect(screen.getByRole('heading', { level: 2, name: 'Getting paid' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up payouts' })).toHaveAttribute(
      'href',
      '/en/owner/payouts',
    );
    await expectNoAxeViolations(first.container);
    first.unmount();
    await card({ available: true, status: 'active' });
    expect(screen.getByRole('link', { name: 'See payouts' })).toBeInTheDocument();
  });

  it('is not there where payouts can’t be set up, or the API can’t say', async () => {
    const off = await card({ available: false, status: 'none' });
    expect(off.container).toBeEmptyDOMElement();
    off.unmount();
    expect((await card(null)).container).toBeEmptyDOMElement();
  });
});
