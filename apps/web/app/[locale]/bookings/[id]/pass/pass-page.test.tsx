import type { Booking } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { encode } from 'uqr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBooking } from '@/lib/bookings.server';
import { keepPass } from '@/lib/offline-pass';
import { requireSession } from '@/lib/session';
import { renderWithProviders } from '@/test/render';

import BookingPassPage, { generateMetadata } from './page';

vi.mock('@/lib/bookings.server', () => ({ loadBooking: vi.fn() }));
vi.mock('@/lib/session', () => ({
  requireSession: vi.fn(() => Promise.resolve({ user: { id: 'account-1' } })),
}));
vi.mock('@/lib/offline-pass', () => ({
  canKeepPasses: vi.fn(() => true),
  keepPass: vi.fn(),
  keptUntil: vi.fn(() => Promise.resolve(null)),
  forgetPass: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found');
  }),
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

const ID = 'b0b0b0b0-0000-4000-8000-000000000001';
const confirmed = (overrides: Partial<Booking> = {}): Booking => ({
  id: ID,
  reference: 'K7M4-Q2ZD',
  status: 'confirmed',
  listing: {
    slug: 'ermou-garage',
    name: 'Γκαράζ Ερμού',
    address: 'Ερμού 1, Αθήνα',
    contentLocale: 'el',
    timeZone: 'Europe/Athens',
  },
  spaceLabel: 'Α1',
  spaceId: 'a1a1a1a1-0000-4000-8000-000000000001',
  vehicleId: null,
  start: '2099-12-10T08:00:00.000Z',
  end: '2099-12-10T10:00:00.000Z',
  total: { amountMinor: 400, currency: 'EUR' },
  cancellationPolicy: 'oneDay',
  holdExpiresAt: '2099-12-01T10:10:00.000Z',
  holdExtensionsLeft: 10,
  vehiclePlate: 'IKB1234',
  confirmedAt: '2099-12-01T10:05:00.000Z',
  cancelledAt: null,
  cancelledBy: null,
  refund: null,
  refundIfCancelled: { amountMinor: 400, currency: 'EUR' },
  checkout: 'confirm',
  payment: null,
  arrivalInstructions: null,
  arrivalInstructionsFrom: null,
  ...overrides,
});
const show = async (found: Awaited<ReturnType<typeof loadBooking>>, locale: 'en' | 'el' = 'en') => {
  vi.mocked(loadBooking).mockResolvedValue(found);
  return renderWithProviders(
    await BookingPassPage({ params: Promise.resolve({ locale, id: ID }) }),
    { locale },
  );
};

beforeEach(() => vi.clearAllMocks());

describe('the booking pass page (5A.3)', () => {
  it('needs the driver signed in, and treats another’s booking as none at all', async () => {
    await expect(show('not-found')).rejects.toThrow('not found');
    expect(requireSession).toHaveBeenCalledWith(`/bookings/${ID}/pass`);
  });

  it('shows the reference as text and as a QR code of the reference alone, with the facts', async () => {
    const { container } = await show(confirmed());
    expect(screen.getByRole('heading', { level: 1, name: 'Your booking pass' })).toBeVisible();
    expect(screen.getByTestId('pass-reference')).toHaveTextContent('K7M4-Q2ZD');
    expect(
      screen.getByRole('img', { name: 'QR code of the booking reference K7M4-Q2ZD' }),
    ).toBeInTheDocument();
    expect(screen.getByText('The code holds only the reference.')).toBeInTheDocument();
    // The facts of the booking, in the owner's words and language.
    expect(screen.getByText('Γκαράζ Ερμού')).toHaveAttribute('lang', 'el');
    expect(screen.getByText('IKB1234')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('draws a QR code of the reference and of nothing else', async () => {
    const draw = (value: string) =>
      encode(value, { border: 2 })
        .data.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : '')))
        .join('');
    const { container } = await show(confirmed());
    const path = container.querySelector('svg[role="img"] path')?.getAttribute('d');
    expect(path).toBe(draw('K7M4-Q2ZD'));
    // Not the booking's id, a link, or the plate: another payload draws another picture.
    for (const other of [ID, `https://parkfairy.example/en/bookings/${ID}`, 'IKB1234']) {
      expect(path).not.toBe(draw(other));
    }
  });

  it('keeps the pass for the account, until a day after the stay ends', async () => {
    await show(confirmed());
    await userEvent.click(await screen.findByRole('button', { name: 'Keep this pass offline' }));
    await waitFor(() => expect(keepPass).toHaveBeenCalled());
    expect(keepPass).toHaveBeenCalledWith(
      `/en/bookings/${ID}/pass`,
      // 2099-12-10 10:00Z, the end, and 24 hours more.
      new Date('2099-12-11T10:00:00.000Z'),
      'account-1',
    );
  });

  it('has no accessibility violations in Greek, nor where there is no pass yet or it can’t be read', async () => {
    const greek = await show(confirmed(), 'el');
    await expectNoAxeViolations(greek.container);
    greek.unmount();
    const notYet = await show(confirmed({ status: 'cancelled' }));
    await expectNoAxeViolations(notYet.container);
    notYet.unmount();
    const unavailable = await show('unavailable');
    await expectNoAxeViolations(unavailable.container);
  });

  it('puts the way in on the pass when the booking shows it, and when it will be shown when not', async () => {
    const first = await show(
      confirmed({
        arrivalInstructions: { text: 'Κωδικός 4821.\nΔεύτερο επίπεδο.', contentLocale: 'el' },
      }),
    );
    expect(screen.getByText(/Κωδικός 4821/)).toHaveAttribute('lang', 'el');
    first.unmount();
    await show(confirmed({ arrivalInstructionsFrom: '2099-12-09T08:00:00.000Z' }));
    expect(screen.getByText(/Shown here from/)).toBeInTheDocument();
  });

  it('offers the calendar file as a download from the API, in the page’s language', async () => {
    await show(confirmed());
    const link = screen.getByRole('link', { name: 'Add to calendar' });
    expect(link).toHaveAttribute('href', `/api/v1/bookings/${ID}/calendar?locale=en`);
    expect(link).toHaveAttribute('download');
    expect(link).toHaveAccessibleDescription(/doesn’t include the way in/);
  });

  it('keeps a pass offline until a day after the stay, through the client part', async () => {
    await show(confirmed());
    expect(await screen.findByRole('button', { name: 'Keep this pass offline' })).toBeVisible();
  });

  it('is only for a booking that stands: a hold, a cancelled one, an expired one has none', async () => {
    for (const status of ['held', 'cancelled', 'expired', 'released'] as const) {
      const view = await show(confirmed({ status }));
      expect(
        screen.getByText('A pass is available once the booking is confirmed.'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('pass-reference')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Add to calendar' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Back to the booking' })).toHaveAttribute(
        'href',
        `/en/bookings/${ID}`,
      );
      view.unmount();
    }
  });

  it('says plainly when the booking can’t be read, rather than that there is no pass', async () => {
    await show('unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('try again');
  });

  it('speaks Greek and names the tab', async () => {
    await show(confirmed(), 'el');
    expect(screen.getByRole('heading', { level: 1, name: 'Η κάρτα κράτησής σας' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Προσθήκη στο ημερολόγιο' })).toHaveAttribute(
      'href',
      `/api/v1/bookings/${ID}/calendar?locale=el`,
    );
    expect(await generateMetadata({ params: Promise.resolve({ locale: 'el', id: ID }) })).toEqual({
      title: 'Κάρτα κράτησης',
    });
  });
});
