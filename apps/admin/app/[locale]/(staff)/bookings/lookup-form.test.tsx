import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { lookUpBooking } from '@/lib/admin-client';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { BookingLookupForm } from './lookup-form';

vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  lookUpBooking: vi.fn(),
}));

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.bookingLookup);
const ID = '7f1f3a52-6a39-4a39-9c0b-0a1b2c3d4e5f';
const found = (id: string | null = ID) => ({ ok: true as const, data: { id } });
const field = () => screen.getByLabelText('Booking reference');
const find = () => userEvent.click(screen.getByRole('button', { name: 'Find the booking' }));

beforeEach(() => {
  vi.mocked(lookUpBooking).mockReset();
});

describe('finding a booking', () => {
  it('asks for one reference, described with its hint, axe-clean', async () => {
    const { container } = renderInSubtree(<BookingLookupForm />);
    expect(field()).toHaveAccessibleDescription(/The reference the driver quotes/);
    expect(field()).toHaveAttribute('aria-required', 'true');
    await expectNoAxeViolations(container);
  });

  it('sends the reference in a request, in capitals, then opens the booking', async () => {
    vi.mocked(lookUpBooking).mockResolvedValue(found());
    renderInSubtree(<BookingLookupForm />);
    await userEvent.type(field(), '  k7m4-q2zd ');
    await find();
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`/bookings/${ID}`));
    expect(lookUpBooking).toHaveBeenCalledWith('K7M4-Q2ZD');
    expect(routerMock.push).not.toHaveBeenCalledWith(expect.stringContaining('K7M4'));
  });

  it('refuses what is not a reference in words, with the focus there, and asks nothing', async () => {
    renderInSubtree(<BookingLookupForm />);
    await userEvent.type(field(), 'K7M4');
    await find();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(field()).toHaveFocus();
    expect(lookUpBooking).not.toHaveBeenCalled();
  });

  it('says so at the field when no booking has the reference', async () => {
    vi.mocked(lookUpBooking).mockResolvedValue(found(null));
    renderInSubtree(<BookingLookupForm />);
    await userEvent.type(field(), 'K7M4-Q2ZD');
    await find();
    await waitFor(() => expect(field()).toHaveFocus());
    expect(field()).toHaveAccessibleDescription(/No booking has this reference/);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('says "too many" for a 429, and ignores a second press while it is working', async () => {
    let finish: (value: never) => void = () => undefined;
    vi.mocked(lookUpBooking).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    renderInSubtree(<BookingLookupForm />);
    await userEvent.type(field(), 'K7M4-Q2ZD');
    await find();
    await userEvent.click(await screen.findByRole('button', { name: 'Looking…' }));
    expect(lookUpBooking).toHaveBeenCalledTimes(1);
    finish({ ok: false, failure: {}, status: 429 } as never);
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many decisions');
  });

  it('reads in Greek, axe-clean', async () => {
    const { container } = renderInSubtree(<BookingLookupForm />, { locale: 'el' });
    expect(screen.getByLabelText('Κωδικός κράτησης')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Εύρεση κράτησης' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
