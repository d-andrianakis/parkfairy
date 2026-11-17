import type { OwnerOnboarding } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadManagedListings, loadOwnerOnboarding, loadOwnerPayouts } from '@/lib/owner.server';
import { getSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';

import OwnerPage from './page';

vi.mock('@/lib/owner.server', () => ({
  loadOwnerOnboarding: vi.fn(),
  loadOwnerPayouts: vi.fn(),
  loadManagedListings: vi.fn(),
}));
// An async server component: its own test is payouts-page.test.tsx.
vi.mock('@/components/owner/payouts-card', () => ({ PayoutsCard: () => null }));
vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
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

const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const managed = [{ id: ID, name: 'Γκαράζ Ερμού', contentLocale: 'el' as const }];
const onboarding = (started: boolean): OwnerOnboarding => ({
  started,
  doneAccountSteps: started ? ['profile', 'tax'] : [],
  listings: [],
});

async function show(
  { started, listings }: { started: boolean; listings: typeof managed },
  locale: 'en' | 'el' = 'en',
) {
  vi.mocked(getSession).mockResolvedValue({ user: { id: 'u' } } as never);
  vi.mocked(loadOwnerOnboarding).mockResolvedValue(onboarding(started));
  vi.mocked(loadOwnerPayouts).mockResolvedValue({ available: true, status: 'none' });
  vi.mocked(loadManagedListings).mockResolvedValue(listings);
  return renderWithProviders(await OwnerPage({ params: Promise.resolve({ locale }) }), { locale });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the owner’s page, for someone who manages a listing (#69)', () => {
  it('puts what they manage under the page’s one h1 when they have no listing of their own', async () => {
    const { container } = await show({ started: false, listings: managed });
    const headings = screen.getAllByRole('heading').filter((heading) => heading.tagName !== 'H3');
    // One h1, first; the managed card's h2 comes after it, never before.
    expect(headings[0]?.tagName).toBe('H1');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const card = screen.getByRole('heading', { level: 2, name: 'Listings you manage' });
    expect(
      card.compareDocumentPosition(headings[0] as Node) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    expect(
      within(card.closest('[data-slot="card"]') as HTMLElement).getByRole('list', {
        name: 'Γκαράζ Ερμού',
      }),
    ).toBeVisible();
    // And the way to list their own is still there.
    expect(screen.getByRole('link', { name: /Start/i })).toHaveAttribute(
      'href',
      '/en/owner/profile',
    );
    await expectNoAxeViolations(container);
  });

  it('links an owner to the calendar, all their bookings and their earnings', async () => {
    await show({ started: true, listings: [] });
    expect(screen.getByRole('link', { name: 'See your calendar' })).toHaveAttribute(
      'href',
      '/en/owner/calendar',
    );
    expect(screen.getByRole('link', { name: 'See all bookings' })).toHaveAttribute(
      'href',
      '/en/owner/bookings',
    );
  });

  it('names the link in Greek too', async () => {
    await show({ started: true, listings: [] }, 'el');
    expect(screen.getByRole('link', { name: 'Δείτε όλες τις κρατήσεις' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/owner\/bookings$/),
    );
  });

  it('shows nothing extra to someone who manages nothing', async () => {
    await show({ started: false, listings: [] });
    expect(screen.queryByRole('heading', { name: 'Listings you manage' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows an owner what they also manage, under their own dashboard', async () => {
    const { container } = await show({ started: true, listings: managed });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Listings you manage' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'href',
      `/en/owner/calendar?listing=${ID}`,
    );
    await expectNoAxeViolations(container);
  });

  it('says it in Greek, and skips the card for an owner who manages nothing', async () => {
    await show({ started: true, listings: managed }, 'el');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Χώροι που διαχειρίζεστε' }),
    ).toBeVisible();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    await show({ started: true, listings: [] }, 'el');
    expect(screen.queryByRole('heading', { name: 'Χώροι που διαχειρίζεστε' })).toBeNull();
  });
});
