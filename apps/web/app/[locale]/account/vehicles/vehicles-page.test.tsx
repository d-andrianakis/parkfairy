import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadVehicles } from '@/lib/bookings.server';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';

import VehiclesPage, { generateMetadata } from './page';

vi.mock('@/lib/bookings.server', () => ({ loadVehicles: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireSession: vi.fn(() => Promise.resolve()) }));
vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  saveMyVehicle: vi.fn(),
  changeMyVehicle: vi.fn(),
  forgetMyVehicle: vi.fn(),
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

const WORK = {
  id: 'a0a0a0a0-0000-4000-8000-000000000001',
  plate: 'IKB1234',
  name: 'Work car',
  heightCm: 190,
  lengthCm: null,
  widthCm: null,
};
const show = async (locale: 'en' | 'el' = 'en') =>
  renderWithProviders(await VehiclesPage({ params: Promise.resolve({ locale }) }), { locale });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the saved vehicles page (5A.2)', () => {
  it('needs the driver signed in', async () => {
    vi.mocked(loadVehicles).mockResolvedValue([]);
    await show();
    expect(requireSession).toHaveBeenCalledWith('/account/vehicles');
  });

  it('has one heading, a way back, what is saved and the form', async () => {
    vi.mocked(loadVehicles).mockResolvedValue([WORK]);
    const { container } = await show();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Saved vehicles' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to your account' })).toHaveAttribute(
      'href',
      '/en/account',
    );
    expect(screen.getByText('IKB1234')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Add a vehicle' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('says when the API could not answer, instead of an empty list that would be a lie', async () => {
    vi.mocked(loadVehicles).mockResolvedValue(null);
    await show();
    expect(screen.getByRole('alert')).toHaveTextContent('can’t load your vehicles');
    expect(screen.queryByRole('region', { name: 'Add a vehicle' })).toBeNull();
  });

  it('speaks Greek, and names the tab', async () => {
    vi.mocked(loadVehicles).mockResolvedValue([]);
    await show('el');
    expect(screen.getByRole('heading', { level: 1, name: 'Αποθηκευμένα οχήματα' })).toBeVisible();
    expect(await generateMetadata({ params: Promise.resolve({ locale: 'el' }) })).toEqual({
      title: 'Αποθηκευμένα οχήματα',
    });
  });
});
