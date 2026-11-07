import { copyListingHoursExceptions, saveListingHoursExceptions } from '@parkfairy/api-client';
import { addDays, DEFAULT_TIME_ZONE, zonedParts } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer, LISTING_ID, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';
import { CopyHoursExceptions, type OtherListing } from './copy-hours-exceptions';
import { HoursExceptionsForm } from './hours-exceptions-form';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  copyListingHoursExceptions: vi.fn(),
  saveListingHoursExceptions: vi.fn(),
}));

const copy = vi.mocked(copyListingHoursExceptions);
const save = vi.mocked(saveListingHoursExceptions);

const OTHERS: OtherListing[] = [
  { id: '22222222-2222-4222-8222-222222222222', name: 'Γκαράζ Πειραιά', contentLocale: 'el' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Harbour lot', contentLocale: 'en' },
  { id: '44444444-4444-4444-8444-444444444444', name: null, contentLocale: 'el' },
];
const [PIRAEUS, HARBOUR, UNNAMED] = OTHERS.map((listing) => listing.id) as [string, string, string];

const show = (unsaved = false, listings = OTHERS) =>
  renderInSubtree(<CopyHoursExceptions id={LISTING_ID} listings={listings} unsaved={unsaved} />);
const copyButton = () => screen.getByRole('button', { name: 'Copy dates' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CopyHoursExceptions', () => {
  it('names each listing in its own language, and copies to those ticked', async () => {
    copy.mockResolvedValue(answer({ results: [{ id: HARBOUR, outcome: 'copied' }] }) as never);
    const { container } = show();
    expect(
      screen.getByRole('heading', { name: 'Copy to your other listings' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Γκαράζ Πειραιά')).toHaveAttribute('lang', 'el');
    expect(screen.getByText('Unnamed listing')).not.toHaveAttribute('lang');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(copy.mock.calls[0]?.[0]).toMatchObject({
      path: { id: LISTING_ID },
      body: { to: [HARBOUR] },
    });
    expect(await screen.findByText('Dates copied to 1 listing')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('chooses every other listing at once, and back again', async () => {
    copy.mockResolvedValue(answer({ results: [] }) as never);
    show();
    const all = screen.getByRole('checkbox', { name: 'All your other listings' });
    await userEvent.click(all);
    for (const name of ['Γκαράζ Πειραιά', 'Harbour lot', 'Unnamed listing']) {
      expect(screen.getByRole('checkbox', { name })).toBeChecked();
    }
    await userEvent.click(copyButton());
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(copy.mock.calls[0]?.[0].body.to.toSorted()).toEqual(
      [PIRAEUS, HARBOUR, UNNAMED].toSorted(),
    );
    // Unticking one leaves "all" unticked; ticking it again clears the lot.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    expect(all).not.toBeChecked();
    await userEvent.click(all);
    await userEvent.click(all);
    expect(screen.getByRole('checkbox', { name: 'Γκαράζ Πειραιά' })).not.toBeChecked();
  });

  it('offers no “all” when there is only one other listing', () => {
    show(false, OTHERS.slice(0, 1));
    expect(
      screen.queryByRole('checkbox', { name: 'All your other listings' }),
    ).not.toBeInTheDocument();
  });

  it('asks for a listing first, and takes the owner to the choice', async () => {
    show();
    await userEvent.click(copyButton());
    expect(await screen.findByText('Choose at least one listing')).toBeInTheDocument();
    const all = screen.getByRole('checkbox', { name: 'All your other listings' });
    await waitFor(() => expect(all).toHaveFocus());
    // Said where the focus lands, not in an alert of its own.
    expect(all).toHaveAccessibleDescription('Choose at least one listing');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(copy).not.toHaveBeenCalled();
    // Ticking one answers it.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    expect(screen.queryByText('Choose at least one listing')).not.toBeInTheDocument();
  });

  it('puts the error on the one listing when there is only one', async () => {
    show(false, OTHERS.slice(0, 1));
    await userEvent.click(copyButton());
    const only = screen.getByRole('checkbox', { name: 'Γκαράζ Πειραιά' });
    await waitFor(() => expect(only).toHaveFocus());
    expect(only).toHaveAccessibleDescription('Choose at least one listing');
  });

  it('says it again on a second press, so it is heard again', async () => {
    show(true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    const first = await screen.findByRole('alert');
    expect(first).toHaveTextContent('Save your changes first: only saved dates are copied.');
    // Cleared, then back on the next frame: a new alert, which screen readers announce again.
    await userEvent.click(copyButton());
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Save your changes first: only saved dates are copied.',
    );
  });

  it('copies only what is saved, so asks for a save first', async () => {
    show(true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    expect(
      await screen.findByText('Save your changes first: only saved dates are copied.'),
    ).toBeInTheDocument();
    expect(copy).not.toHaveBeenCalled();
  });

  it('names the listings that kept their own dates, and why', async () => {
    copy.mockResolvedValue(
      answer({
        results: [
          { id: PIRAEUS, outcome: 'clash' },
          { id: HARBOUR, outcome: 'copied' },
          { id: UNNAMED, outcome: 'full' },
        ],
      }) as never,
    );
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'All your other listings' }));
    await userEvent.click(copyButton());
    // The report, not the count of fields that need attention beside it.
    const status = (await screen.findByText('Dates copied to 1 listing')).closest(
      '[role="status"]',
    ) as HTMLElement;
    expect(status).toHaveTextContent(
      'Not copied to “Γκαράζ Πειραιά”: it already has its own closures or special hours on one of these days.',
    );
    expect(status).toHaveTextContent(
      'Not copied to “Unnamed listing”: it would go over the limit of 30 periods.',
    );
    // The owner's names are read in the language they wrote them in.
    expect(within(status).getByText('Γκαράζ Πειραιά')).toHaveAttribute('lang', 'el');
    expect(within(status).getByText('Unnamed listing')).not.toHaveAttribute('lang');
  });

  it('translates a refusal from the server', async () => {
    copy.mockResolvedValue(refusal('LISTING_NOT_FOUND', 404) as never);
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    expect(await screen.findByText('We can’t find that listing.')).toBeInTheDocument();
  });

  it('reads in Greek', () => {
    renderInSubtree(<CopyHoursExceptions id={LISTING_ID} listings={OTHERS} unsaved={false} />, {
      locale: 'el',
    });
    expect(
      screen.getByRole('heading', { name: 'Αντιγραφή στους άλλους χώρους σας' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Όλοι οι άλλοι χώροι σας' })).toBeInTheDocument();
  });
});

describe('copying from the closures form', () => {
  const TODAY = zonedParts(new Date(), DEFAULT_TIME_ZONE).date;
  const entry = {
    label: null,
    startsOn: addDays(TODAY, 5),
    endsOn: addDays(TODAY, 5),
    hours: null,
    closedHours: null,
  };
  const form = (exceptions: (typeof entry)[], otherListings = OTHERS) =>
    renderInSubtree(
      <HoursExceptionsForm
        id={LISTING_ID}
        exceptions={exceptions}
        today={TODAY}
        otherListings={otherListings}
      />,
    );

  it('appears once there is something saved to copy, and other listings to copy it to', async () => {
    save.mockResolvedValue(answer({ exceptions: [entry] }) as never);
    const { unmount } = form([], []);
    expect(
      screen.queryByRole('heading', { name: 'Copy to your other listings' }),
    ).not.toBeInTheDocument();
    unmount();
    form([]);
    expect(
      screen.queryByRole('heading', { name: 'Copy to your other listings' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add dates' }));
    await userEvent.type(screen.getByLabelText('First day'), entry.startsOn);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByRole('heading', { name: 'Copy to your other listings' }),
    ).toBeInTheDocument();
  });

  it('knows about changes not yet saved, and forgets them once they are', async () => {
    save.mockResolvedValue(answer({ exceptions: [entry] }) as never);
    copy.mockResolvedValue(answer({ results: [{ id: HARBOUR, outcome: 'copied' }] }) as never);
    form([entry]);
    await userEvent.type(screen.getByLabelText('Your note for period 1 (optional)'), 'x');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    expect(
      await screen.findByText('Save your changes first: only saved dates are copied.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved');
    await userEvent.click(copyButton());
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
  });
});
