import { holdParkingSpace } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { loadPage } from '@/lib/load-page';
import { routerMock } from '@/test/navigation-mock';
import { answer, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';

import { RebookButton } from './rebook-button';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  holdParkingSpace: vi.fn(),
}));
vi.mock('@/lib/load-page', () => ({ loadPage: vi.fn() }));
const hold = vi.mocked(holdParkingSpace);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.rebook);

const SPACE = '11111111-1111-4111-8111-111111111111';
const VEHICLE = 'a0a0a0a0-0000-4000-8000-000000000001';
const stay = { start: '2026-12-07T08:00:00.000Z', end: '2026-12-07T10:00:00.000Z' };
const show = (vehicleId: string | null = VEHICLE, locale: 'en' | 'el' = 'en') =>
  renderInSubtree(
    <>
      <p id="when">Same weekday and times: Mon 7 Dec</p>
      <RebookButton
        listing="ermou-garage"
        spaceId={SPACE}
        vehicleId={vehicleId}
        {...stay}
        chooseHref="/parking/ermou-garage?startDate=2026-12-07"
        describedBy="when"
      />
    </>,
    { locale },
  );
const button = () => screen.getByRole('button', { name: 'Book again' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RebookButton (5A.2)', () => {
  it('says which times it is for', async () => {
    const { container } = show();
    expect(button()).toHaveAccessibleDescription('Same weekday and times: Mon 7 Dec');
    await expectNoAxeViolations(container);
  });

  it('holds the same space for the same car, and goes on to that booking', async () => {
    hold.mockResolvedValue(answer({ id: 'b1', checkout: 'confirm' }) as never);
    show();
    await userEvent.click(button());
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/bookings/b1'));
    expect(hold).toHaveBeenCalledWith({
      body: { listing: 'ermou-garage', spaceId: SPACE, ...stay, vehicleId: VEHICLE },
    });
  });

  it('asks for no vehicle when the booking had none saved', async () => {
    hold.mockResolvedValue(answer({ id: 'b1', checkout: 'confirm' }) as never);
    show(null);
    await userEvent.click(button());
    await waitFor(() => expect(hold).toHaveBeenCalledOnce());
    expect(hold.mock.calls[0]?.[0]?.body).not.toHaveProperty('vehicleId');
  });

  it('loads a real page where drivers pay, for the policy Stripe needs', async () => {
    hold.mockResolvedValue(answer({ id: 'b1', checkout: 'payment' }) as never);
    show();
    await userEvent.click(button());
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/en/bookings/b1'));
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it.each([
    ['SPACE_TAKEN', /Someone else has just booked this space/],
    ['LISTING_CLOSED', /can’t be booked for your stay/],
    ['VEHICLE_DOES_NOT_FIT', /too small for this vehicle/],
  ])('says %s, and offers the listing for the same times', async (code, words) => {
    hold.mockResolvedValue(refusal(code) as never);
    show();
    await userEvent.click(button());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(words);
    expect(
      within(alert).getByRole('link', { name: 'Choose another space or time' }),
    ).toHaveAttribute('href', '/en/parking/ermou-garage?startDate=2026-12-07');
    // Pressed again once it is answered.
    expect(button()).toBeEnabled();
  });

  it('offers no way on for a refusal that choosing again would not help', async () => {
    hold.mockResolvedValue(refusal('OWN_LISTING') as never);
    show();
    await userEvent.click(button());
    expect(await screen.findByRole('alert')).toHaveTextContent('your own parking');
    expect(screen.queryByRole('link', { name: 'Choose another space or time' })).toBeNull();
  });

  it('holds once for a double press', async () => {
    let finish: (value: never) => void = () => {};
    hold.mockReturnValue(new Promise((resolve) => (finish = resolve)) as never);
    show();
    await userEvent.click(button());
    expect(screen.getByRole('button', { name: 'Holding the space…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Holding the space…' }));
    expect(hold).toHaveBeenCalledOnce();
    finish(answer({ id: 'b1', checkout: 'confirm' }) as never);
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledOnce());
  });

  it('speaks Greek', () => {
    show(VEHICLE, 'el');
    expect(screen.getByRole('button', { name: 'Νέα κράτηση' })).toBeInTheDocument();
  });
});
