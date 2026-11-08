import { holdParkingSpace } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer, refusal } from '@/test/owner-fixtures';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor, renderWithProviders } from '@/test/render';
import { BookSpaceForm, type SpaceOption } from './book-space-form';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  holdParkingSpace: vi.fn(),
}));
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
      'We keep the space for you for 10 minutes while you confirm.',
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
