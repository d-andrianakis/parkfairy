import { holdParkingSpace } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { loadPage } from '@/lib/load-page';
import { routerMock } from '@/test/navigation-mock';
import { answer, refusal } from '@/test/owner-fixtures';
import { rendererFor, renderWithProviders } from '@/test/render';

import { BookSpaceForm, type SpaceOption, type VehicleOption } from './book-space-form';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  holdParkingSpace: vi.fn(),
}));
vi.mock('@/lib/load-page', () => ({ loadPage: vi.fn() }));
const hold = vi.mocked(holdParkingSpace);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.bookSpace);

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const option = (id: string, label: string, price: string): SpaceOption => ({
  id,
  label: <span lang="el">{label}</span>,
  details: <span>{price}</span>,
});
const SPACES = [option(A1, 'Α1', '€4.00 for your stay'), option(A2, 'Α2', '€8.00 for your stay')];
const stay = { start: '2026-12-10T08:00:00.000Z', end: '2026-12-10T10:00:00.000Z' };

const show = (spaces = SPACES, locale: 'en' | 'el' = 'en') =>
  renderInSubtree(
    <>
      <h2 id="spaces-heading">Choose your space</h2>
      <BookSpaceForm
        listing="ermou-garage"
        {...stay}
        spaces={spaces}
        initial={A1}
        labelledBy="spaces-heading"
      />
    </>,
    { locale },
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BookSpaceForm', () => {
  it('offers the free spaces, the cheapest picked, each read with its price', async () => {
    const { container } = show();
    // Named by the section's heading alone: no second group around it.
    expect(screen.getByRole('radiogroup', { name: 'Choose your space' })).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    // The ten minutes are said with the button, before it is pressed.
    expect(screen.getByRole('button', { name: 'Book this space' })).toHaveAccessibleDescription(
      'We keep the space for you for 10 minutes while you book.',
    );
    const first = screen.getByRole('radio', { name: 'Α1' });
    expect(first).toBeChecked();
    expect(first).toHaveAccessibleDescription('€4.00 for your stay');
    expect(screen.getByText('Α1')).toHaveAttribute('lang', 'el');
    await expectNoAxeViolations(container);
  });

  it('holds the space picked and goes on to the booking', async () => {
    hold.mockResolvedValue(answer({ id: 'b1' }) as never);
    show();
    await userEvent.click(screen.getByRole('radio', { name: 'Α2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Book this space' }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/bookings/b1'));
    expect(hold).toHaveBeenCalledWith({
      body: { listing: 'ermou-garage', spaceId: A2, ...stay },
    });
  });

  it('loads the booking’s page as a page of its own when it is paid for (decision #49)', async () => {
    hold.mockResolvedValue(answer({ id: 'b1', checkout: 'payment' }) as never);
    show(SPACES, 'el');
    await userEvent.click(screen.getByRole('button', { name: /^Κράτηση/ }));
    // Its CSP is the one that lets Stripe in: a client navigation would keep this page's.
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/el/bookings/b1'));
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('says when another driver got there first, and reads the list again', async () => {
    hold.mockResolvedValue(refusal('SPACE_TAKEN') as never);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Book this space' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else has just booked');
    expect(routerMock.refresh).toHaveBeenCalledOnce();
    expect(routerMock.push).not.toHaveBeenCalled();
    // The button stays where it was, ready for another try.
    expect(screen.getByRole('button', { name: 'Book this space' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('keeps the press from being repeated while it holds', async () => {
    let settle: (value: unknown) => void = () => undefined;
    hold.mockReturnValue(new Promise((resolve) => (settle = resolve)) as never);
    show();
    const button = screen.getByRole('button', { name: 'Book this space' });
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Holding the space…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Holding the space…' }));
    expect(hold).toHaveBeenCalledOnce();
    settle(answer({ id: 'b1' }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledOnce());
  });

  it('picks nothing in its place when the space picked has gone, and asks for one', async () => {
    hold.mockResolvedValue(answer({ id: 'b2' }) as never);
    show([SPACES[1] as SpaceOption]);
    expect(screen.getByRole('radio', { name: 'Α2' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Book this space' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a space first.');
    expect(screen.getByRole('radio', { name: 'Α2' })).toHaveFocus();
    expect(hold).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('radio', { name: 'Α2' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Book this space' }));
    await waitFor(() => expect(hold).toHaveBeenCalledOnce());
    expect(hold.mock.calls[0]?.[0]).toMatchObject({ body: { spaceId: A2 } });
  });

  it('reads each space with its features, not the name of their list', async () => {
    const { FeatureBadges } = await import('./feature-badges');
    renderWithProviders(
      <>
        <h2 id="spaces-heading">Choose your space</h2>
        <BookSpaceForm
          listing="ermou-garage"
          {...stay}
          initial={A1}
          labelledBy="spaces-heading"
          spaces={[
            {
              id: A1,
              label: 'Α1',
              details: (
                <>
                  <FeatureBadges features={['accessible']} named={false} />
                  <span>€4.00 for your stay</span>
                </>
              ),
            },
          ]}
        />
      </>,
      { namespaces: [...CLIENT_NAMESPACES.bookSpace, 'Features'] },
    );
    expect(screen.getByRole('radio', { name: 'Α1' })).toHaveAccessibleDescription(
      /Accessible.*€4\.00 for your stay/,
    );
  });

  it('keeps saying the space was taken once the refresh leaves none free', async () => {
    hold.mockResolvedValue(refusal('SPACE_TAKEN') as never);
    // What the page brings back with nothing free: the same form, no spaces.
    function Refreshed() {
      const [spaces, setSpaces] = useState(SPACES);
      return (
        <>
          <h2 id="spaces-heading" tabIndex={-1}>
            Choose your space
          </h2>
          <button type="button" onClick={() => setSpaces([])}>
            Refresh
          </button>
          <BookSpaceForm
            listing="ermou-garage"
            {...stay}
            spaces={spaces}
            initial={A1}
            labelledBy="spaces-heading"
          />
        </>
      );
    }
    renderInSubtree(<Refreshed />);
    await userEvent.click(screen.getByRole('button', { name: 'Book this space' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else has just booked');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    // The same alert, now saying the last one went; the focus where the button was, on the heading.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Someone else has just booked the last free space for those times.',
    );
    expect(screen.queryByRole('button', { name: 'Book this space' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose your space' })).toHaveFocus();
  });

  it('speaks Greek, with a translated refusal', async () => {
    hold.mockResolvedValue(refusal('OWN_LISTING') as never);
    show(SPACES, 'el');
    await userEvent.click(screen.getByRole('button', { name: 'Κράτηση αυτής της θέσης' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('δικός σας');
    expect(screen.getByText(/10 λεπτά/)).toBeInTheDocument();
  });

  it('never shows server text for a refusal it doesn’t know', async () => {
    hold.mockResolvedValue(refusal('SOMETHING_ELSE', 500, ['Internal detail']) as never);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Book this space' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).not.toHaveTextContent('Internal detail');
  });
});

// A saved vehicle (5A.2): chosen here, held for, and warned about where a space is too small for it.
describe('BookSpaceForm with saved vehicles', () => {
  const WORK: VehicleOption = {
    id: 'a0a0a0a0-0000-4000-8000-000000000001',
    label: 'Work car · IKB1234',
    heightCm: 210,
    lengthCm: null,
    widthCm: null,
  };
  const SMALL: VehicleOption = {
    id: 'a0a0a0a0-0000-4000-8000-000000000002',
    label: 'YZM5678',
    heightCm: 150,
    lengthCm: 400,
    widthCm: null,
  };
  // A1 takes up to 190 cm high; A2 has no stated limit.
  const SIZED = [
    {
      ...option(A1, 'Α1', '€4.00 for your stay'),
      limits: { heightCm: 190, lengthCm: null, widthCm: null },
    },
    {
      ...option(A2, 'Α2', '€8.00 for your stay'),
      limits: { heightCm: null, lengthCm: null, widthCm: null },
    },
  ];
  const showWith = (vehicles: VehicleOption[], locale: 'en' | 'el' = 'en') =>
    renderInSubtree(
      <>
        <h2 id="spaces-heading">Choose your space</h2>
        <BookSpaceForm
          listing="ermou-garage"
          {...stay}
          spaces={SIZED}
          initial={A1}
          labelledBy="spaces-heading"
          vehicles={vehicles}
        />
      </>,
      { locale },
    );
  const picker = () => screen.getByRole('combobox', { name: 'Vehicle' });

  it('shows no choice to a driver with no saved vehicle, and sends no vehicle', async () => {
    hold.mockResolvedValue(answer({ id: 'b1' }) as never);
    showWith([]);
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Book this space' }));
    await waitFor(() => expect(hold).toHaveBeenCalledOnce());
    expect(hold.mock.calls[0]?.[0]?.body).not.toHaveProperty('vehicleId');
  });

  it('offers the first vehicle and a way to none, with a link to manage them', async () => {
    const { container } = showWith([WORK, SMALL]);
    expect(picker()).toHaveValue(WORK.id);
    expect(screen.getByRole('option', { name: 'No saved vehicle' })).toBeInTheDocument();
    expect(picker()).toHaveAccessibleDescription(
      /Pick a vehicle and we’ll tell you which spaces are too small for it/,
    );
    expect(screen.getByRole('link', { name: 'Manage saved vehicles' })).toHaveAttribute(
      'href',
      '/en/account/vehicles',
    );
    await expectNoAxeViolations(container);
  });

  it('says which spaces are too small for the vehicle, in words, and not for the others', async () => {
    showWith([WORK, SMALL]);
    expect(screen.getByRole('radio', { name: 'Α1' })).toHaveAccessibleDescription(
      '€4.00 for your stay Too small for this vehicle',
    );
    expect(screen.getByRole('radio', { name: 'Α2' })).toHaveAccessibleDescription(
      '€8.00 for your stay',
    );
    await userEvent.selectOptions(picker(), 'YZM5678');
    expect(screen.getByRole('radio', { name: 'Α1' })).toHaveAccessibleDescription(
      '€4.00 for your stay',
    );
    await userEvent.selectOptions(picker(), 'No saved vehicle');
    expect(screen.queryByText('Too small for this vehicle')).toBeNull();
  });

  it('says how many spaces are too small when the vehicle changes, in a polite status', async () => {
    showWith([WORK, SMALL]);
    const status = () =>
      screen
        .getAllByRole('status')
        .map((region) => region.textContent)
        .join(' ');
    expect(status()).toContain('1 space is too small for this vehicle.');
    await userEvent.selectOptions(picker(), 'YZM5678');
    expect(status()).toContain('Every space fits this vehicle.');
    await userEvent.selectOptions(picker(), 'No saved vehicle');
    expect(status()).not.toContain('space');
  });

  it('holds the space for the vehicle chosen', async () => {
    hold.mockResolvedValue(answer({ id: 'b1' }) as never);
    showWith([WORK]);
    await userEvent.click(screen.getByRole('radio', { name: 'Α2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Book this space' }));
    await waitFor(() => expect(hold).toHaveBeenCalledOnce());
    expect(hold).toHaveBeenCalledWith({
      body: { listing: 'ermou-garage', spaceId: A2, ...stay, vehicleId: WORK.id },
    });
  });

  it('refuses a space that is too small before asking, naming the vehicle, with the focus back', async () => {
    showWith([WORK]);
    await userEvent.click(screen.getByRole('button', { name: 'Book this space' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'That space is too small for Work car · IKB1234. Choose another space or vehicle.',
    );
    expect(screen.getByRole('radio', { name: 'Α1' })).toHaveFocus();
    expect(hold).not.toHaveBeenCalled();
    // Another vehicle clears it, and the same space can be held.
    hold.mockResolvedValue(answer({ id: 'b1' }) as never);
    await userEvent.selectOptions(picker(), 'No saved vehicle');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Book this space' }));
    await waitFor(() => expect(hold).toHaveBeenCalledOnce());
  });

  it('says what the API says when it refuses the vehicle all the same', async () => {
    hold.mockResolvedValue(refusal('VEHICLE_DOES_NOT_FIT') as never);
    showWith([SMALL]);
    await userEvent.click(screen.getByRole('button', { name: 'Book this space' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('too small for this vehicle');
  });

  it('speaks Greek', () => {
    showWith([WORK], 'el');
    expect(screen.getByRole('combobox', { name: 'Όχημα' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Α1' })).toHaveAccessibleDescription(
      /Πολύ μικρή για αυτό το όχημα/,
    );
  });
});
