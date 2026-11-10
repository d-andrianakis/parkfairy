import {
  saveListingHours,
  saveListingLocation,
  saveListingPrices,
  saveListingSpaces,
} from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { routerMock } from '@/test/navigation-mock';
import {
  answer,
  LISTING_ID,
  listingFixture,
  progressFixture,
  refusal,
} from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';
import { HoursForm } from './hours-form';
import { LocationForm } from './location-form';
import { PricesForm } from './prices-form';
import { SpacesForm } from './spaces-form';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  saveListingHours: vi.fn(),
  saveListingLocation: vi.fn(),
  saveListingPrices: vi.fn(),
  saveListingSpaces: vi.fn(),
}));
vi.mock('./location-map', () => ({ default: () => <div data-testid="map" /> }));

const continueButton = () => screen.getByRole('button', { name: 'Save and continue' });
const nextIs = (step: Parameters<typeof progressFixture>[0]) =>
  answer(progressFixture(step)) as never;
const ok = (mock: { mockResolvedValue: (value: never) => unknown }, nextStep = 'photos') =>
  mock.mockResolvedValue(nextIs({ nextStep: nextStep as 'photos' }));

beforeEach(() => {
  vi.clearAllMocks();
  ok(vi.mocked(saveListingSpaces));
  ok(vi.mocked(saveListingHours));
  ok(vi.mocked(saveListingPrices));
  ok(vi.mocked(saveListingLocation));
});

const booked = (code: string, bookings: number) => ({
  error: { code, statusCode: 409, message: code, bookings },
  response: new Response(null, { status: 409 }),
});

describe('SpacesForm', () => {
  const save = vi.mocked(saveListingSpaces);

  it('refuses removing booked spaces, with the way to the bookings; another refusal has none', async () => {
    save.mockResolvedValueOnce(booked('SPACES_BOOKED', 2) as never);
    const listing = listingFixture({
      spaces: [{ id: 'a', label: 'A1', features: [], hourlyRateMinor: null }],
    });
    renderInSubtree(<SpacesForm listing={listing} />);
    await userEvent.click(continueButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Drivers have 2 bookings on spaces you’re removing');
    expect(within(alert).getByRole('link', { name: 'See the bookings' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${LISTING_ID}/bookings`,
    );
    save.mockResolvedValueOnce(refusal('LISTING_LOCKED') as never);
    await userEvent.click(continueButton());
    expect(await screen.findByText('This listing can’t be changed right now.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See the bookings' })).not.toBeInTheDocument();
  });

  async function addThree() {
    await userEvent.type(screen.getByLabelText('Prefix (optional)'), 'A');
    await userEvent.clear(screen.getByLabelText('How many'));
    await userEvent.type(screen.getByLabelText('How many'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Add spaces' }));
  }

  it('makes a run of spaces in one go, and says so', async () => {
    const { container } = renderInSubtree(<SpacesForm listing={listingFixture()} />);
    await addThree();
    expect(screen.getByRole('heading', { name: '3 spaces' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name of space 1')).toHaveValue('A1');
    expect(screen.getByLabelText('Name of space 3')).toHaveValue('A3');
    expect(await screen.findByText('3 spaces added')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('carries on numbering from where the last run stopped', async () => {
    renderInSubtree(<SpacesForm listing={listingFixture()} />);
    await addThree();
    await userEvent.click(screen.getByRole('button', { name: 'Add spaces' }));
    expect(screen.getByLabelText('Name of space 4')).toHaveValue('A4');
  });

  it('gives a run the features ticked for it', async () => {
    renderInSubtree(<SpacesForm listing={listingFixture()} />);
    await userEvent.click(screen.getByLabelText('Covered'));
    await addThree();
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const body = save.mock.calls[0]?.[0].body;
    expect(body?.spaces[0]).toEqual({ label: 'A1', features: ['covered'], hourlyRateMinor: null });
  });

  it('names what each checkbox and button is about', async () => {
    renderInSubtree(<SpacesForm listing={listingFixture()} />);
    await addThree();
    expect(screen.getByRole('checkbox', { name: 'Covered: A2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove A2' })).toBeInTheDocument();
  });

  it('removes a space, says so and keeps the focus in the list', async () => {
    renderInSubtree(<SpacesForm listing={listingFixture()} />);
    await addThree();
    await userEvent.click(screen.getByRole('button', { name: 'Remove A2' }));
    expect(screen.getByRole('heading', { name: '2 spaces' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('A2')).not.toBeInTheDocument();
    expect(await screen.findByText('A2 removed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove A3' })).toHaveFocus());
  });

  it('reports a bad rate on the rate, not the name', async () => {
    renderInSubtree(<SpacesForm listing={listingFixture()} />);
    await addThree();
    const rate = screen.getAllByLabelText('Own hourly rate (€) (optional)')[0];
    if (!rate) throw new Error('No rate field');
    await userEvent.type(rate, 'abc');
    await userEvent.click(continueButton());
    await waitFor(() => expect(rate).toHaveFocus());
    expect(rate).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name of space 1')).not.toHaveAttribute('aria-invalid');
  });

  it('explains a run it can’t make', async () => {
    renderInSubtree(<SpacesForm listing={listingFixture()} />);
    const many = screen.getByLabelText('How many');
    await userEvent.clear(many);
    await userEvent.type(many, '501');
    await userEvent.click(screen.getByRole('button', { name: 'Add spaces' }));
    expect(await screen.findByText('A listing can have up to 500 spaces')).toBeInTheDocument();
    await waitFor(() => expect(many).toHaveFocus());
  });

  it('reads a rate typed the Greek way, as whole cents', async () => {
    renderInSubtree(<SpacesForm listing={listingFixture()} />);
    await addThree();
    const rate = screen.getAllByLabelText('Own hourly rate (€) (optional)')[0];
    if (!rate) throw new Error('No rate field');
    await userEvent.type(rate, '4,35');
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0].body?.spaces[0]?.hourlyRateMinor).toBe(435);
  });

  it('points at a duplicate name and sends nothing', async () => {
    renderInSubtree(<SpacesForm listing={listingFixture()} />);
    await addThree();
    const second = screen.getByLabelText('Name of space 2');
    await userEvent.clear(second);
    await userEvent.type(second, 'a1');
    await userEvent.click(continueButton());
    expect(await screen.findByText('Another space has this name')).toBeInTheDocument();
    expect(second).toHaveFocus();
    expect(save).not.toHaveBeenCalled();
  });

  it('needs at least one space', async () => {
    renderInSubtree(<SpacesForm listing={listingFixture()} />);
    await userEvent.click(continueButton());
    expect(await screen.findByText('Add at least one space')).toBeInTheDocument();
  });

  it('goes to the step the server says is next', async () => {
    const listing = listingFixture({
      spaces: [{ id: LISTING_ID, label: 'A1', features: [], hourlyRateMinor: null }],
    });
    renderInSubtree(<SpacesForm listing={listing} />);
    await userEvent.click(continueButton());
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith(`/owner/listings/${LISTING_ID}/photos`),
    );
  });

  it('saves and returns to the dashboard when finishing later', async () => {
    const listing = listingFixture({
      spaces: [{ id: LISTING_ID, label: 'A1', features: [], hourlyRateMinor: null }],
    });
    renderInSubtree(<SpacesForm listing={listing} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save and finish later' }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/owner'));
    expect(save).toHaveBeenCalledOnce();
  });
});

describe('HoursForm', () => {
  const save = vi.mocked(saveListingHours);
  const periods = () => save.mock.calls[0]?.[0].body?.periods;

  it('starts closed, and refuses to save a week with no opening', async () => {
    const { container } = renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(continueButton());
    expect(await screen.findByText('Choose at least one day you’re open')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('fills the week from a preset, and says so', async () => {
    renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open all day, every day' }));
    expect(await screen.findByText('Set to open all day, every day')).toBeInTheDocument();
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(periods()).toHaveLength(7);
    expect(periods()?.[0]).toEqual({ weekday: 1, opens: '00:00', closes: '24:00' });
  });

  it('turns a late close into two periods', async () => {
    renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open on Monday' }));
    await userEvent.selectOptions(screen.getByLabelText('Opens on Monday'), '18:00');
    await userEvent.selectOptions(screen.getByLabelText('Closes on Monday'), '02:00');
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(periods()).toEqual([
      { weekday: 1, opens: '18:00', closes: '24:00' },
      { weekday: 2, opens: '00:00', closes: '02:00' },
    ]);
  });

  it('shows an overlap on the day it belongs to', async () => {
    renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open on Monday' }));
    await userEvent.selectOptions(screen.getByLabelText('Opens on Monday'), '18:00');
    await userEvent.selectOptions(screen.getByLabelText('Closes on Monday'), '10:00');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open on Tuesday' }));
    await userEvent.click(continueButton());
    expect(await screen.findByText(/Two opening times overlap/)).toBeInTheDocument();
    const closing = screen.getByLabelText('Closes on Tuesday');
    await waitFor(() => expect(closing).toHaveFocus());
    expect(closing).toHaveAttribute('aria-invalid', 'true');
  });

  it('takes a closed part out of a day, and sends two periods', async () => {
    const { container } = renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Monday to Friday, 08:00–20:00' }));
    expect(screen.queryByLabelText('Closed from, Monday')).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Closed for part of the day, Monday' }),
    );
    expect(screen.getByLabelText('Closed from, Monday')).toHaveValue('14:00');
    await userEvent.selectOptions(screen.getByLabelText('Closed until, Monday'), '16:30');
    await expectNoAxeViolations(container);
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(periods()?.slice(0, 3)).toEqual([
      { weekday: 1, opens: '08:00', closes: '14:00' },
      { weekday: 1, opens: '16:30', closes: '20:00' },
      { weekday: 2, opens: '08:00', closes: '20:00' },
    ]);
  });

  it('refuses a closed part outside the hours, at the time to change', async () => {
    renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Monday to Friday, 08:00–20:00' }));
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Closed for part of the day, Tuesday' }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Closed until, Tuesday'), '21:00');
    await userEvent.click(continueButton());
    const until = screen.getByLabelText('Closed until, Tuesday');
    await waitFor(() => expect(until).toHaveFocus());
    expect(until).toHaveAccessibleDescription(
      'Choose a closed time inside the opening hours, before midnight',
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('goes to the step the server says is next', async () => {
    renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open all day, every day' }));
    await userEvent.click(continueButton());
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith(`/owner/listings/${LISTING_ID}/photos`),
    );
  });

  it('saves and returns to the dashboard when finishing later', async () => {
    renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open all day, every day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save and finish later' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(routerMock.push).toHaveBeenCalledWith('/owner');
  });

  it('refuses a week that would strand bookings, with the way to them, in Greek', async () => {
    save.mockResolvedValueOnce(booked('LISTING_BOOKED', 1) as never);
    renderInSubtree(<HoursForm listing={listingFixture()} />, { locale: 'el' });
    await userEvent.click(screen.getByRole('button', { name: 'Ανοιχτά όλο το 24ωρο, κάθε ημέρα' }));
    await userEvent.click(screen.getByRole('button', { name: 'Αποθήκευση και συνέχεια' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Υπάρχει μία κράτηση στις ώρες που κλείνετε');
    expect(within(alert).getByRole('link', { name: 'Δείτε τις κρατήσεις' })).toHaveAttribute(
      'href',
      // The navigation mock writes every link in English.
      `/en/owner/listings/${LISTING_ID}/bookings`,
    );
  });

  it('reports a refusal and stays, ready to save again', async () => {
    save.mockResolvedValueOnce(refusal('LISTING_LOCKED') as never);
    renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open all day, every day' }));
    await userEvent.click(continueButton());
    expect(await screen.findByText('This listing can’t be changed right now.')).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(continueButton()).not.toHaveAttribute('aria-disabled');
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  it('says which of a closed part’s times is wrong, and why', async () => {
    renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Monday to Friday, 08:00–20:00' }));
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Closed for part of the day, Monday' }),
    );
    // Starting before the day opens: the start is what needs changing.
    await userEvent.selectOptions(screen.getByLabelText('Closed from, Monday'), '07:00');
    await userEvent.click(continueButton());
    const from = screen.getByLabelText('Closed from, Monday');
    await waitFor(() => expect(from).toHaveFocus());
    expect(from).toHaveAccessibleDescription(
      'Choose a closed time inside the opening hours, before midnight',
    );
    // Backwards: said on its end, in those words.
    await userEvent.selectOptions(from, '15:00');
    await userEvent.selectOptions(screen.getByLabelText('Closed until, Monday'), '12:00');
    await userEvent.click(continueButton());
    const until = screen.getByLabelText('Closed until, Monday');
    await waitFor(() => expect(until).toHaveFocus());
    expect(until).toHaveAccessibleDescription('The closed time must end after it starts');
    expect(save).not.toHaveBeenCalled();
  });

  it('clears closed parts when a preset fills the week', async () => {
    renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Monday to Friday, 08:00–20:00' }));
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Closed for part of the day, Monday' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Monday to Friday, 08:00–20:00' }));
    expect(
      screen.getByRole('checkbox', { name: 'Closed for part of the day, Monday' }),
    ).not.toBeChecked();
  });

  it('drops a closed part when the owner unticks it', async () => {
    renderInSubtree(<HoursForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Monday to Friday, 08:00–20:00' }));
    const toggle = screen.getByRole('checkbox', { name: 'Closed for part of the day, Monday' });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(periods()?.[0]).toEqual({ weekday: 1, opens: '08:00', closes: '20:00' });
  });

  it('shows a saved break as the owner set it, in Greek', () => {
    const listing = listingFixture({
      openingHours: [
        { weekday: 1, opens: '08:00', closes: '14:00' },
        { weekday: 1, opens: '17:00', closes: '20:00' },
      ],
    });
    renderInSubtree(<HoursForm listing={listing} />, { locale: 'el' });
    expect(
      screen.getByRole('checkbox', { name: 'Κλειστά για μέρος της ημέρας: Δευτέρα' }),
    ).toBeChecked();
    expect(screen.getByLabelText('Κλειστά από: Δευτέρα')).toHaveValue('14:00');
    expect(screen.getByLabelText('Κλειστά έως: Δευτέρα')).toHaveValue('17:00');
    expect(screen.getByLabelText('Κλείνει: Δευτέρα')).toHaveValue('20:00');
  });

  it('shows saved hours as they were entered, in Greek day names', () => {
    const listing = listingFixture({
      openingHours: [
        { weekday: 1, opens: '18:00', closes: '24:00' },
        { weekday: 2, opens: '00:00', closes: '02:00' },
      ],
    });
    renderInSubtree(<HoursForm listing={listing} />, { locale: 'el' });
    expect(screen.getByRole('checkbox', { name: 'Ανοιχτά: Δευτέρα' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ανοιχτά: Τρίτη' })).not.toBeChecked();
    expect(screen.getByLabelText('Κλείνει: Δευτέρα')).toHaveValue('02:00');
  });
});

describe('PricesForm', () => {
  const save = vi.mocked(saveListingPrices);
  const body = () => save.mock.calls[0]?.[0].body;

  async function basics() {
    await userEvent.type(screen.getByLabelText('Hourly rate (€)'), '3,50');
    await userEvent.click(screen.getByRole('radio', { name: 'Moderate' }));
  }

  it('saves the simplest listing, in whole cents', async () => {
    const { container } = renderInSubtree(<PricesForm listing={listingFixture()} />);
    await basics();
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(body()).toMatchObject({
      hourlyRateMinor: 350,
      dailyMaxMinor: null,
      cancellationPolicy: 'oneDay',
      bookingGapMinutes: 0,
      weekendRateMinor: null,
      night: null,
    });
    await expectNoAxeViolations(container);
  });

  it('moves to the first problem, with the reason beside it', async () => {
    renderInSubtree(<PricesForm listing={listingFixture()} />);
    await userEvent.click(continueButton());
    const hourly = screen.getByLabelText('Hourly rate (€)');
    await waitFor(() => expect(hourly).toHaveFocus());
    expect(hourly).toHaveAccessibleDescription(expect.stringContaining('from €0.10'));
    expect(save).not.toHaveBeenCalled();
  });

  it('reveals each special price only when asked for', async () => {
    renderInSubtree(<PricesForm listing={listingFixture()} />);
    expect(screen.queryByLabelText('Weekend hourly rate (€)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('A different price at the weekend'));
    await basics();
    await userEvent.type(screen.getByLabelText('Weekend hourly rate (€)'), '5');
    await userEvent.click(screen.getByLabelText('A different price at night'));
    await userEvent.type(screen.getByLabelText('Night hourly rate (€)'), '1,20');
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(body()?.weekendRateMinor).toBe(500);
    expect(body()?.night).toEqual({ rateMinor: 120, from: '22:00', to: '06:00' });
  });

  it('sends nothing for a price that was switched off', async () => {
    const listing = listingFixture();
    listing.prices = {
      ...listing.prices,
      hourlyRateMinor: 300,
      cancellationPolicy: 'oneDay',
      weekendRateMinor: 500,
    };
    renderInSubtree(<PricesForm listing={listing} />);
    await userEvent.click(screen.getByLabelText('A different price at the weekend'));
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(body()?.weekendRateMinor).toBeNull();
  });

  it('adds and removes dated prices', async () => {
    renderInSubtree(<PricesForm listing={listingFixture()} />);
    await basics();
    await userEvent.click(screen.getByRole('button', { name: 'Add dates' }));
    await userEvent.type(screen.getByLabelText('First day'), '2099-08-14');
    await userEvent.type(screen.getByLabelText('Last day'), '2099-08-16');
    await userEvent.type(
      screen.getByLabelText('Hourly rate (€)', { selector: '[id*="dated"]' }),
      '6',
    );
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(body()?.datedPrices).toEqual([
      { label: null, startsOn: '2099-08-14', endsOn: '2099-08-16', rateMinor: 600 },
    ]);
  });

  it('shows a refused date range beside its field', async () => {
    renderInSubtree(<PricesForm listing={listingFixture()} />);
    await basics();
    await userEvent.click(screen.getByRole('button', { name: 'Add dates' }));
    await userEvent.type(screen.getByLabelText('First day'), '2099-08-16');
    await userEvent.type(screen.getByLabelText('Last day'), '2099-08-14');
    await userEvent.type(
      screen.getByLabelText('Hourly rate (€)', { selector: '[id*="dated"]' }),
      '6',
    );
    await userEvent.click(continueButton());
    expect(await screen.findByText('Check these dates')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('adds a long-stay discount with sensible defaults', async () => {
    renderInSubtree(<PricesForm listing={listingFixture()} />);
    await basics();
    await userEvent.click(screen.getByRole('button', { name: 'Add a discount' }));
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(body()?.longStayDiscounts).toEqual([{ minDays: 7, percent: 10 }]);
  });

  it('takes the owner to the policy when it is what’s missing', async () => {
    renderInSubtree(<PricesForm listing={listingFixture()} />);
    await userEvent.type(screen.getByLabelText('Hourly rate (€)'), '3,50');
    await userEvent.click(continueButton());
    await waitFor(() => expect(screen.getByRole('radio', { name: /Flexible/ })).toHaveFocus());
    expect(screen.getByRole('radio', { name: /Flexible/ })).toHaveAccessibleDescription(
      expect.stringContaining('Choose a cancellation policy'),
    );
  });

  it('moves the focus into a new row, and back to Add when it is removed', async () => {
    renderInSubtree(<PricesForm listing={listingFixture()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a discount' }));
    await waitFor(() => expect(screen.getByLabelText('Days for discount 1')).toHaveFocus());
    await userEvent.click(screen.getByRole('button', { name: 'Remove discount 1' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add a discount' })).toHaveFocus(),
    );
  });

  it('saves the gap chosen', async () => {
    renderInSubtree(<PricesForm listing={listingFixture()} />);
    await basics();
    await userEvent.selectOptions(screen.getByLabelText('Gap between bookings on a space'), '30');
    await userEvent.click(continueButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(body()?.bookingGapMinutes).toBe(30);
  });

  it('stops offering discounts at the limit', async () => {
    renderInSubtree(<PricesForm listing={listingFixture()} />);
    const add = screen.getByRole('button', { name: 'Add a discount' });
    await userEvent.click(add);
    await userEvent.click(add);
    await userEvent.click(add);
    expect(screen.queryByRole('button', { name: 'Add a discount' })).not.toBeInTheDocument();
  });

  it('shows saved amounts with the decimal mark of the language', () => {
    const listing = listingFixture();
    listing.prices = { ...listing.prices, hourlyRateMinor: 350 };
    renderInSubtree(<PricesForm listing={listing} />, { locale: 'el' });
    expect(screen.getByLabelText('Τιμή ανά ώρα (€)')).toHaveValue('3,50');
  });
});

describe('LocationForm', () => {
  const save = vi.mocked(saveListingLocation);
  const fill = async () => {
    await userEvent.type(screen.getByLabelText('Name of your parking'), 'Γκαράζ');
    await userEvent.type(screen.getByLabelText('Address'), 'Ερμού 1');
    await userEvent.type(screen.getByLabelText('Latitude'), '37.9755');
    await userEvent.type(screen.getByLabelText('Longitude'), '23.7348');
    await userEvent.tab();
  };

  it('works without a map: every field reachable, and axe clean', async () => {
    const { container } = renderInSubtree(
      <LocationForm listing={listingFixture()} mapboxToken={null} />,
    );
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Find this address' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Latitude')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('adds the map and address search when there is a token', async () => {
    renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken="pk.test" />);
    // Not until asked for: it is heavy, and each one shown is billed.
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the map' }));
    expect(await screen.findByTestId('map')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find this address' })).toBeInTheDocument();
    // The way in without a pointer stays either way (WCAG 2.5.7).
    expect(screen.getByLabelText('Latitude')).toBeInTheDocument();
  });

  it('saves the pin with the nearest area, and says so', async () => {
    renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken={null} />);
    await fill();
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        path: { id: LISTING_ID },
        body: { latitude: 37.9755, longitude: 23.7348, areaId: 'syntagma' },
      }),
    );
    expect(screen.getByLabelText('Area')).toHaveValue('syntagma');
    expect(await screen.findByText('Position saved')).toBeInTheDocument();
  });

  it('refuses a pin abroad beside the field', async () => {
    renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken={null} />);
    await userEvent.type(screen.getByLabelText('Latitude'), '52.5');
    await userEvent.type(screen.getByLabelText('Longitude'), '13.4');
    await userEvent.tab();
    await waitFor(() =>
      expect(screen.getByLabelText('Latitude')).toHaveAccessibleDescription(
        expect.stringContaining('This position is outside Greece'),
      ),
    );
    expect(screen.getByLabelText('Latitude')).toHaveAttribute('aria-invalid', 'true');
    expect(save).not.toHaveBeenCalled();
  });

  it('accepts a comma in a coordinate', async () => {
    renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken={null} />);
    await userEvent.type(screen.getByLabelText('Latitude'), '37,9755');
    await userEvent.type(screen.getByLabelText('Longitude'), '23,7348');
    await userEvent.tab();
    await waitFor(() => expect(screen.getByLabelText('Area')).toHaveValue('syntagma'));
  });

  it('saves the name as the owner leaves it', async () => {
    renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken={null} />);
    await userEvent.type(screen.getByLabelText('Name of your parking'), 'Γκαράζ');
    await userEvent.tab();
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ path: { id: LISTING_ID }, body: { name: 'Γκαράζ' } }),
    );
  });

  it('blocks continuing until the step is complete, but not leaving', async () => {
    renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken={null} />);
    await userEvent.click(continueButton());
    expect(await screen.findByText('Give your parking a name')).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Save and finish later' }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/owner'));
  });

  it('moves on when everything is there', async () => {
    renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken={null} />);
    await fill();
    await userEvent.click(continueButton());
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith(`/owner/listings/${LISTING_ID}/photos`),
    );
  });

  it('shows the owner’s text as their language, not the page’s', () => {
    renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken={null} />);
    expect(screen.getByLabelText('Name of your parking')).toHaveAttribute('lang', 'el');
    const language = screen.getByLabelText('Language of your text');
    expect(within(language).getByRole('option', { name: 'Ελληνικά' })).toHaveAttribute(
      'lang',
      'el',
    );
  });

  describe('finding the address', () => {
    const match = {
      id: 'a',
      geometry: { coordinates: [23.7348, 37.9755] },
      properties: { full_address: 'Ερμού 1, Αθήνα 105 63' },
    };
    const answerWith = (features: unknown[], status = 200) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(JSON.stringify({ features }), { status }))),
      );
    const searchFor = async (address = 'Ερμού 1', contentLocale: 'el' | 'en' = 'el') => {
      renderInSubtree(
        <LocationForm
          listing={listingFixture({ location: { ...listingFixture().location, contentLocale } })}
          mapboxToken="pk.test"
        />,
      );
      if (address) await userEvent.type(screen.getByLabelText('Address'), address);
      await userEvent.click(screen.getByRole('button', { name: 'Find this address' }));
    };
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('offers what it finds, and a choice fills the address and the pin', async () => {
      answerWith([match]);
      await searchFor();
      const choice = await screen.findByRole('button', { name: 'Ερμού 1, Αθήνα 105 63' });
      // Asked for, and marked, in the listing's language: the one it is saved and shown in.
      expect(
        new URL(String(vi.mocked(fetch).mock.calls[0]?.[0])).searchParams.get('language'),
      ).toBe('el');
      expect(choice.querySelector('[lang="el"]')).toHaveTextContent('Ερμού 1, Αθήνα 105 63');
      await userEvent.click(choice);

      expect(screen.getByLabelText('Address')).toHaveValue('Ερμού 1, Αθήνα 105 63');
      expect(screen.getByLabelText('Latitude')).toHaveValue('37.9755');
      expect(screen.getByLabelText('Area')).toHaveValue('syntagma');
      // The button that had the focus went with the list.
      await waitFor(() => expect(screen.getByLabelText('Address')).toHaveFocus());
      await waitFor(() =>
        expect(save).toHaveBeenCalledWith({
          path: { id: LISTING_ID },
          body: expect.objectContaining({ latitude: 37.9755 }),
        }),
      );
    });

    it('asks in English for an English listing, its Greek words marked, and forgets them on a switch', async () => {
      answerWith([{ ...match, properties: { full_address: 'Οδός Ερμού 1, Athens 105 63' } }]);
      await searchFor('Ermou 1', 'en');
      const choice = await screen.findByRole('button', { name: 'Οδός Ερμού 1, Athens 105 63' });
      expect(
        new URL(String(vi.mocked(fetch).mock.calls[0]?.[0])).searchParams.get('language'),
      ).toBe('en');
      const words = choice.querySelector('[lang="en"]');
      expect(words?.querySelector('[lang="el"]')).toHaveTextContent(/^Οδός Ερμού$/);
      // Found in English: they would be saved under Greek after the switch, so they go.
      await userEvent.selectOptions(screen.getByLabelText('Language of your text'), 'el');
      expect(
        screen.queryByRole('button', { name: 'Οδός Ερμού 1, Athens 105 63' }),
      ).not.toBeInTheDocument();
    });

    it('says when nothing matched', async () => {
      answerWith([]);
      await searchFor();
      expect(await screen.findByText(/^No addresses found\. Check/)).toBeInTheDocument();
    });

    it('tells a failed search from one with no results', async () => {
      answerWith([], 500);
      await searchFor();
      expect(await screen.findByText(/address search isn’t available/)).toBeInTheDocument();
      expect(screen.queryByText(/^No addresses found/)).not.toBeInTheDocument();
    });

    it('asks for an address first, at the field', async () => {
      answerWith([]);
      await searchFor('');
      await waitFor(() => expect(screen.getByLabelText('Address')).toHaveFocus());
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('the owner’s location', () => {
    const geolocation = (implementation: (ok: never, fail: never) => void) => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition: implementation },
      });
    };
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'geolocation');
    });

    it('fills the pin', async () => {
      geolocation(((ok: (position: unknown) => void) =>
        ok({ coords: { latitude: 37.9755, longitude: 23.7348 } })) as never);
      renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken={null} />);
      await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
      expect(screen.getByLabelText('Longitude')).toHaveValue('23.7348');
    });

    it('explains a refusal to everyone, not only screen readers', async () => {
      geolocation(((_ok: unknown, fail: (error: unknown) => void) =>
        fail({ code: 1, PERMISSION_DENIED: 1 })) as never);
      renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken={null} />);
      await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
      const notice = await screen.findByText(/didn’t share your location/);
      expect(notice).not.toHaveClass('sr-only');
    });

    it('says when the browser has no location at all', async () => {
      renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken={null} />);
      await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
      expect(await screen.findByText(/location isn’t available/)).toBeInTheDocument();
    });
  });

  it('keeps a wrong longitude on the longitude field', async () => {
    renderInSubtree(<LocationForm listing={listingFixture()} mapboxToken={null} />);
    await userEvent.type(screen.getByLabelText('Name of your parking'), 'Γκαράζ');
    await userEvent.type(screen.getByLabelText('Address'), 'Ερμού 1');
    await userEvent.type(screen.getByLabelText('Latitude'), '37.9');
    await userEvent.click(continueButton());
    await waitFor(() => expect(screen.getByLabelText('Longitude')).toHaveFocus());
    expect(screen.getByLabelText('Latitude')).not.toHaveAttribute('aria-invalid');
  });

  it('reports a locked listing rather than pretending to save', async () => {
    const listing = listingFixture({
      location: {
        name: 'Γκαράζ',
        address: 'Ερμού 1',
        areaId: 'syntagma',
        latitude: 37.97,
        longitude: 23.73,
        description: null,
        contentLocale: 'el',
      },
    });
    save.mockResolvedValue(refusal('LISTING_LOCKED') as never);
    renderInSubtree(<LocationForm listing={listing} mapboxToken={null} />);
    await userEvent.click(continueButton());
    expect(await screen.findByText('This listing can’t be changed right now.')).toBeInTheDocument();
  });
});
