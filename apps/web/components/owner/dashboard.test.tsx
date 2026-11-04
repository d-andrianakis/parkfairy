import { LISTING_STATUSES } from '@parkfairy/contracts';
import { createOwnerListing, deleteOwnerListing, submitOwnerListing } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { loadPage } from '@/lib/load-page';
import { routerMock } from '@/test/navigation-mock';
import {
  answer,
  LISTING_ID,
  listingFixture,
  progressFixture,
  refusal,
} from '@/test/owner-fixtures';
import { rendererFor, renderWithProviders } from '@/test/render';
import { AccountChecklist } from './account-checklist';
import { ContinueCard } from './continue-card';
import { DeleteDraftButton, NewListingButton } from './listing-actions';
import { ListingMilestones } from './listing-milestones';
import { OwnerLanding, SignedOutActions } from './owner-landing';
import { ReviewSummary } from './review-summary';
import { StepShell } from './step-shell';
import { SubmitListing } from './submit-listing';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  createOwnerListing: vi.fn(),
  deleteOwnerListing: vi.fn(),
  submitOwnerListing: vi.fn(),
}));

vi.mock('@/lib/load-page', () => ({ loadPage: vi.fn() }));

const progress = { done: 6, total: 10, percent: 60 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OwnerLanding', () => {
  it('says what it takes before asking for anything', async () => {
    const { container } = renderWithProviders(<OwnerLanding action={<SignedOutActions />} />, {
      locale: 'el',
    });
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Τι θα χρειαστείτε' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('brings someone signing in back here', () => {
    renderWithProviders(<SignedOutActions />);
    expect(screen.getByRole('link', { name: 'I already have an account' })).toHaveAttribute(
      'href',
      '/en/sign-in?next=%2Fowner',
    );
  });
});

describe('ContinueCard', () => {
  it('loads a real page for the location step, so the map’s policy applies', () => {
    const href = `/owner/listings/${LISTING_ID}/location`;
    renderInSubtree(
      <ContinueCard
        action={{ kind: 'listing', step: 'location', href, listing: progressFixture() }}
        progress={progress}
      />,
    );
    expect(screen.getByRole('link', { name: 'Continue: Location' })).toHaveAttribute(
      'href',
      `/en${href}`,
    );
  });

  it('names the step and links to it', async () => {
    const { container } = renderInSubtree(
      <ContinueCard
        action={{ kind: 'account', step: 'tax', href: '/owner/tax' }}
        progress={progress}
      />,
    );
    expect(screen.getByRole('link', { name: 'Continue: Tax details' })).toHaveAttribute(
      'href',
      '/en/owner/tax',
    );
    await expectNoAxeViolations(container);
  });

  it('reports progress as text and to assistive technology', () => {
    renderInSubtree(<ContinueCard action={{ kind: 'done' }} progress={progress} />);
    expect(screen.getByText('6 of 10 steps done')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: '6 of 10 steps done' });
    expect(bar).toHaveAttribute('aria-valuenow', '60');
  });

  it('tells an owner with nothing to do that nothing is needed', () => {
    renderInSubtree(<ContinueCard action={{ kind: 'done' }} progress={progress} />);
    expect(screen.getByRole('heading', { name: 'You’re all caught up' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('invites a first listing once the account is done', () => {
    renderInSubtree(<ContinueCard action={{ kind: 'newListing' }} progress={progress} />);
    expect(screen.getByRole('button', { name: 'Add your parking' })).toBeInTheDocument();
  });
});

describe('AccountChecklist', () => {
  it('counts the confirmed account as done, and says each step’s state in words', () => {
    renderInSubtree(<AccountChecklist done={['profile']} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Account and email confirmed Done');
    expect(items[1]).toHaveTextContent('About you Done');
    expect(items[2]).toHaveTextContent('Tax details To do');
  });
});

describe('ListingMilestones', () => {
  it('groups the steps under milestones, with their counts', async () => {
    const { container } = renderInSubtree(
      <ListingMilestones listing={progressFixture({ doneSteps: ['location', 'photos'] })} />,
    );
    expect(screen.getByRole('heading', { name: /Your parking\s*1 of 3/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Photos and proof\s*1 of 2/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Location\s*Done$/ })).toHaveAttribute(
      'href',
      `/en/owner/listings/${LISTING_ID}/location`,
    );
    await expectNoAxeViolations(container);
  });

  it('names a listing still without one', () => {
    renderInSubtree(<ListingMilestones listing={progressFixture({ name: null })} />);
    expect(screen.getByRole('heading', { name: 'Unnamed listing' })).toBeInTheDocument();
  });

  it('shows what staff asked for, as the owner’s to fix', () => {
    renderInSubtree(
      <ListingMilestones
        listing={progressFixture({
          status: 'changes_requested',
          reviewNote: 'Χρειάζεται καλύτερη φωτογραφία.',
        })}
      />,
    );
    expect(screen.getByText('Needs a change')).toBeInTheDocument();
    expect(screen.getByText('Χρειάζεται καλύτερη φωτογραφία.')).toBeInTheDocument();
  });

  it('shows where a listing with staff has got to', () => {
    renderInSubtree(
      <ListingMilestones listing={progressFixture({ status: 'in_review', nextStep: null })} />,
    );
    expect(screen.getByText('We’re checking it now')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('links a live listing to its public page', () => {
    renderInSubtree(
      <ListingMilestones
        listing={progressFixture({ status: 'published', slug: 'garaz-ermou', nextStep: null })}
      />,
    );
    expect(screen.getByRole('link', { name: /as drivers see it/ })).toHaveAttribute(
      'href',
      '/en/parking/garaz-ermou',
    );
  });

  it.each(LISTING_STATUSES)(
    'offers closures and special hours on a listing that is %s, named for it',
    (status) => {
      renderInSubtree(<ListingMilestones listing={progressFixture({ status })} />);
      expect(
        screen.getByRole('link', { name: 'Closures and special hours for “Γκαράζ Ερμού”' }),
      ).toHaveAttribute('href', `/en/owner/listings/${LISTING_ID}/closures`);
    },
  );

  it('reads the listing’s name in its own language inside the link', () => {
    renderInSubtree(<ListingMilestones listing={progressFixture()} />, { locale: 'el' });
    const link = screen.getByRole('link', {
      name: 'Κλειστές ημέρες και ειδικό ωράριο για «Γκαράζ Ερμού»',
    });
    expect(within(link).getByText('Γκαράζ Ερμού')).toHaveAttribute('lang', 'el');
  });

  it('shows the owner’s cover photo as decoration', () => {
    const { container } = renderInSubtree(
      <ListingMilestones
        listing={progressFixture({
          coverPhoto: {
            key: 'a'.repeat(32),
            width: 1600,
            height: 1067,
            alt: 'x',
            color: '#112233',
          },
        })}
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });
});

describe('NewListingButton', () => {
  it('starts a draft and opens its first step', async () => {
    vi.mocked(createOwnerListing).mockResolvedValue(answer({ id: LISTING_ID }) as never);
    renderInSubtree(<NewListingButton label="Add" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    // A real page load, so the map gets the policy that allows it.
    await waitFor(() =>
      expect(loadPage).toHaveBeenCalledWith(`/en/owner/listings/${LISTING_ID}/location`),
    );
  });

  it('explains a refusal', async () => {
    vi.mocked(createOwnerListing).mockResolvedValue(refusal('TOO_MANY_LISTINGS') as never);
    renderInSubtree(<NewListingButton label="Add" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/number of listings/)).toBeInTheDocument();
  });

  it('ignores a second press while the first is working', async () => {
    let finish: (value: never) => void = () => undefined;
    vi.mocked(createOwnerListing).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve as never;
      }) as never,
    );
    renderInSubtree(<NewListingButton label="Add" />);
    const button = screen.getByRole('button', { name: 'Add' });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(createOwnerListing).toHaveBeenCalledOnce();
    finish(answer({ id: LISTING_ID }) as never);
    await waitFor(() => expect(loadPage).toHaveBeenCalled());
  });
});

describe('DeleteDraftButton', () => {
  it('asks first, in place, and deletes only on the second press', async () => {
    vi.mocked(deleteOwnerListing).mockResolvedValue(answer(undefined) as never);
    renderInSubtree(<DeleteDraftButton id={LISTING_ID} name="Γκαράζ" />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete “Γκαράζ”' }));
    expect(deleteOwnerListing).not.toHaveBeenCalled();
    expect(screen.getByText(/everything in it/)).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalled());
    expect(screen.getByRole('status')).toHaveTextContent('Draft deleted');
  });

  it('can be called off', async () => {
    renderInSubtree(<DeleteDraftButton id={LISTING_ID} name="Γκαράζ" />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete “Γκαράζ”' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(deleteOwnerListing).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete “Γκαράζ”' })).toHaveFocus(),
    );
  });

  it('reads properly for a draft with no name', async () => {
    renderInSubtree(<DeleteDraftButton id={LISTING_ID} name={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete this draft' }));
    expect(screen.getByText(/^Delete this draft and everything/)).toBeInTheDocument();
  });
});

describe('StepShell', () => {
  const done = progressFixture({ doneSteps: ['location'] });

  it('marks the current step, and leaves every step one press away', async () => {
    const { container } = renderInSubtree(
      <StepShell listing={listingFixture({ progress: done })} step="hours">
        <p>form</p>
      </StepShell>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Opening hours' })).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 7')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Steps for this parking' });
    expect(within(nav).getAllByRole('link')).toHaveLength(7);
    expect(within(nav).getByRole('link', { current: 'step' })).toHaveTextContent('Opening hours');
    await expectNoAxeViolations(container);
  });

  it('keeps the note from staff in view while fixing', () => {
    const sentBack = progressFixture({ status: 'changes_requested', reviewNote: 'Μια αλλαγή.' });
    renderInSubtree(
      <StepShell listing={listingFixture({ progress: sentBack })} step="photos">
        <p>form</p>
      </StepShell>,
    );
    expect(screen.getByText('What needs changing')).toBeInTheDocument();
    expect(screen.getByText('Μια αλλαγή.')).toBeInTheDocument();
  });
});

describe('ReviewSummary', () => {
  it('lists what is missing, with a way to each', () => {
    renderInSubtree(<ReviewSummary listing={listingFixture()} doneAccountSteps={['profile']} />);
    expect(screen.getByText('Still needed before you can send this')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tax details' })).toHaveAttribute(
      'href',
      '/en/owner/tax',
    );
    expect(screen.getByRole('link', { name: 'Photos' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${LISTING_ID}/photos`,
    );
  });

  it('summarises prices the way drivers will read them', () => {
    const listing = listingFixture();
    listing.prices = {
      hourlyRateMinor: 350,
      dailyMaxMinor: 2000,
      bookingGapMinutes: 0,
      cancellationPolicy: 'oneDay',
      weekendRateMinor: 500,
      night: { rateMinor: 120, from: '22:00', to: '06:00' },
      datedPrices: [{ label: null, startsOn: '2099-08-14', endsOn: '2099-08-16', rateMinor: 600 }],
      longStayDiscounts: [{ minDays: 7, percent: 10 }],
    };
    renderInSubtree(<ReviewSummary listing={listing} doneAccountSteps={['profile', 'tax']} />);
    expect(screen.getByText('€3.50 an hour')).toBeInTheDocument();
    expect(screen.getByText('Up to €20.00 a day')).toBeInTheDocument();
    expect(screen.getByText('€5.00 an hour at the weekend')).toBeInTheDocument();
    expect(screen.getByText('€1.20 an hour from 10:00 PM to 6:00 AM')).toBeInTheDocument();
    expect(screen.getByText('1 dated price')).toBeInTheDocument();
    expect(screen.getByText('10% off stays of 7 days or more')).toBeInTheDocument();
    expect(screen.getByText('Cancellation policy: Moderate')).toBeInTheDocument();
  });

  it('offers no edits on a locked listing', () => {
    renderInSubtree(
      <ReviewSummary listing={listingFixture({ locked: true })} doneAccountSteps={[]} />,
    );
    expect(screen.queryByRole('link', { name: /Change/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Still needed before you can send this')).not.toBeInTheDocument();
  });
});

describe('SubmitListing', () => {
  const submit = vi.mocked(submitOwnerListing);
  const send = () => screen.getByRole('button', { name: 'Send for review' });

  it('needs the box ticked, and takes the owner to it', async () => {
    const { container } = renderInSubtree(<SubmitListing id={LISTING_ID} resubmitting={false} />);
    await userEvent.click(send());
    expect(
      await screen.findByText('Tick this to send your parking for review'),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('sends the listing and returns to a refreshed dashboard', async () => {
    submit.mockResolvedValue(answer(progressFixture()) as never);
    renderInSubtree(<SubmitListing id={LISTING_ID} resubmitting={false} />);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(send());
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/owner'));
    expect(routerMock.refresh).toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith({ path: { id: LISTING_ID }, body: { confirmed: true } });
  });

  it('reads differently for a listing sent back', () => {
    renderInSubtree(<SubmitListing id={LISTING_ID} resubmitting />);
    expect(screen.getByRole('button', { name: 'Send it again' })).toBeInTheDocument();
  });

  it('explains when the server says a step is unfinished', async () => {
    submit.mockResolvedValue(refusal('LISTING_INCOMPLETE') as never);
    renderInSubtree(<SubmitListing id={LISTING_ID} resubmitting={false} />);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(send());
    expect(await screen.findByText('Some steps aren’t finished yet.')).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
  });
});
