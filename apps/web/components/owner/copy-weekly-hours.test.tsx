import { copyListingHours, saveListingHours } from '@parkfairy/api-client';
import type { OpeningPeriod } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import type { OtherListing } from './copy-to-listings';
import { HoursForm } from './hours-form';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  copyListingHours: vi.fn(),
  saveListingHours: vi.fn(),
}));

const copy = vi.mocked(copyListingHours);
const save = vi.mocked(saveListingHours);

const DRAFTS: OtherListing[] = [
  { id: '22222222-2222-4222-8222-222222222222', name: 'Γκαράζ Πειραιά', contentLocale: 'el' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Harbour lot', contentLocale: 'en' },
];
const [PIRAEUS, HARBOUR] = DRAFTS.map((draft) => draft.id) as [string, string];

const WEEKDAYS_ONLY: OpeningPeriod[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  opens: '08:00',
  closes: '20:00',
}));

function show(
  openingHours: OpeningPeriod[] = WEEKDAYS_ONLY,
  otherListings = DRAFTS,
  locale: 'el' | 'en' = 'en',
) {
  return renderInSubtree(
    <HoursForm listing={listingFixture({ openingHours })} otherListings={otherListings} />,
    { locale },
  );
}
const copyButton = () => screen.getByRole('button', { name: 'Copy hours' });

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue(answer(progressFixture({ nextStep: 'prices' })) as never);
  copy.mockImplementation(
    async ({ body }) =>
      answer({ results: body.to.map((id) => ({ id, outcome: 'copied' as const })) }) as never,
  );
});

describe('copying the weekly hours', () => {
  it('is offered only when the owner has another listing that can take them', () => {
    const { unmount } = show(WEEKDAYS_ONLY, []);
    expect(
      screen.queryByRole('heading', { name: 'Copy these hours to other listings' }),
    ).toBeNull();
    unmount();
    show();
    expect(
      screen.getByRole('heading', { name: 'Copy these hours to other listings' }),
    ).toBeInTheDocument();
  });

  it('copies saved hours as they are, and stays on the step', async () => {
    const { container } = show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(save).not.toHaveBeenCalled();
    expect(copy.mock.calls[0]?.[0].body).toEqual({ to: [HARBOUR] });
    expect(await screen.findByText('Hours copied to 1 listing')).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('saves changes first, then copies what was saved, without leaving the step', async () => {
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open on Saturday' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'All of these listings' }));
    await userEvent.click(copyButton());
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(copy.mock.invocationCallOrder[0] ?? 0);
    expect(save.mock.calls[0]?.[0].body?.periods).toContainEqual({
      weekday: 6,
      opens: '08:00',
      closes: '20:00',
    });
    expect(copy.mock.calls[0]?.[0].body.to.toSorted()).toEqual([PIRAEUS, HARBOUR].toSorted());
    expect(routerMock.push).not.toHaveBeenCalled();
    // What was saved is now what the page holds: copying again saves nothing.
    await screen.findByText('Hours saved and copied to 2 listings');
    await userEvent.click(copyButton());
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenCalledOnce();
  });

  it('copies nothing while the hours can’t be saved, and shows why at the day', async () => {
    show();
    await userEvent.selectOptions(screen.getByLabelText('Opens on Monday'), '18:00');
    await userEvent.selectOptions(screen.getByLabelText('Closes on Monday'), '10:00');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    const closing = screen.getByLabelText('Closes on Tuesday');
    await waitFor(() => expect(closing).toHaveFocus());
    expect(save).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(copyButton()).not.toHaveAttribute('aria-disabled');
  });

  it('names a listing that kept its hours, in its own language', async () => {
    copy.mockResolvedValueOnce(
      answer({ results: [{ id: PIRAEUS, outcome: 'locked' as const }] }) as never,
    );
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Γκαράζ Πειραιά' }));
    await userEvent.click(copyButton());
    const status = await screen.findByText(/^Hours not copied to/);
    expect(status).toHaveTextContent(
      'Hours not copied to “Γκαράζ Πειραιά”: we’re checking it or it’s live, so it keeps its own.',
    );
    expect(within(status).getByText('Γκαράζ Πειραιά')).toHaveAttribute('lang', 'el');
  });

  it('names a listing sent back whose bookings the week would strand', async () => {
    copy.mockResolvedValueOnce(
      answer({ results: [{ id: PIRAEUS, outcome: 'booked' as const }] }) as never,
    );
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Γκαράζ Πειραιά' }));
    await userEvent.click(copyButton());
    const status = await screen.findByText(/^Hours not copied to/);
    expect(status).toHaveTextContent(
      'Hours not copied to “Γκαράζ Πειραιά”: drivers are booked in hours it would close.',
    );
  });

  it('explains a listing with no hours to copy', async () => {
    copy.mockResolvedValueOnce(refusal('NOTHING_TO_COPY') as never);
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    expect(
      await screen.findByText(
        'There are no hours to copy yet. First choose at least one day you’re open, above.',
      ),
    ).toBeInTheDocument();
  });

  it('asks for a listing first, on the choice itself', async () => {
    show();
    await userEvent.click(copyButton());
    const all = screen.getByRole('checkbox', { name: 'All of these listings' });
    await waitFor(() => expect(all).toHaveFocus());
    expect(all).toHaveAccessibleDescription('Choose at least one listing');
    expect(save).not.toHaveBeenCalled();
  });

  it('reads in Greek, the owner’s names in their own language', async () => {
    copy.mockResolvedValueOnce(
      answer({
        results: [
          { id: PIRAEUS, outcome: 'copied' as const },
          { id: HARBOUR, outcome: 'locked' as const },
        ],
      }) as never,
    );
    const { container } = show(WEEKDAYS_ONLY, DRAFTS, 'el');
    expect(
      screen.getByRole('heading', { name: 'Ίδιο ωράριο και σε άλλους χώρους σας' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Όλοι αυτοί οι χώροι' }));
    await userEvent.click(screen.getByRole('button', { name: 'Αντιγραφή ωραρίου' }));
    expect(await screen.findByText('Το ωράριο αντιγράφηκε σε 1 χώρο')).toBeInTheDocument();
    const locked = screen.getByText(/^Το ωράριο δεν αντιγράφηκε στον χώρο/);
    expect(locked).toHaveTextContent(
      'Το ωράριο δεν αντιγράφηκε στον χώρο «Harbour lot»: τον ελέγχουμε ή έχει δημοσιευτεί, οπότε κρατά το δικό του.',
    );
    expect(within(locked).getByText('Harbour lot')).toHaveAttribute('lang', 'en');
    await expectNoAxeViolations(container);
  });

  it('says it saved as well as copied, and keeps the focus on the button', async () => {
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open on Saturday' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    expect(await screen.findByText('Hours saved and copied to 1 listing')).toBeInTheDocument();
    expect(copyButton()).toHaveFocus();
    // The step list and progress come from the server: fetched again to show the step done.
    expect(routerMock.refresh).toHaveBeenCalledOnce();
  });

  it('says it is saving while it saves, then copying', async () => {
    let finish: (value: never) => void = () => undefined;
    save.mockImplementationOnce(
      () => new Promise<never>((resolve) => (finish = resolve)) as ReturnType<typeof save>,
    );
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open on Saturday' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    const section = screen.getByRole('region', { name: 'Copy these hours to other listings' });
    const busy = await within(section).findByRole('button', { name: 'Saving…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    finish(answer(progressFixture({ nextStep: 'prices' })) as never);
    expect(await screen.findByText('Hours saved and copied to 1 listing')).toBeInTheDocument();
  });

  it('copies nothing when the save is refused, says why here, and saves again next time', async () => {
    save.mockResolvedValueOnce(refusal('LISTING_LOCKED') as never);
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open on Saturday' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    expect(await screen.findByText('This listing can’t be changed right now.')).toBeInTheDocument();
    expect(
      await screen.findByText('Nothing was copied: the hours above couldn’t be saved.'),
    ).toBeInTheDocument();
    expect(copy).not.toHaveBeenCalled();
    expect(copyButton()).not.toHaveAttribute('aria-disabled');
    expect(routerMock.push).not.toHaveBeenCalled();
    // Still unsaved, so the next press saves again.
    await userEvent.click(copyButton());
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('copies nothing when the connection drops during the save', async () => {
    save.mockRejectedValueOnce(new Error('offline'));
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open on Saturday' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    expect(
      await screen.findByText('Nothing was copied: the hours above couldn’t be saved.'),
    ).toBeInTheDocument();
    expect(copy).not.toHaveBeenCalled();
  });

  it('says the week was saved when only the copy is refused, and saves it once', async () => {
    copy.mockResolvedValueOnce(refusal('LISTING_NOT_FOUND', 404) as never);
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open on Saturday' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    expect(
      await screen.findByText('Your hours were saved, but not copied. We can’t find that listing.'),
    ).toBeInTheDocument();
    await userEvent.click(copyButton());
    expect(await screen.findByText('Hours copied to 1 listing')).toBeInTheDocument();
    expect(save).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledTimes(2);
  });

  it('still moves on with Save and continue after a copy', async () => {
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open on Saturday' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    await screen.findByText('Hours saved and copied to 1 listing');
    const next = screen.getByRole('button', { name: 'Save and continue' });
    expect(next).not.toHaveAttribute('aria-disabled');
    await userEvent.click(next);
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith(`/owner/listings/${LISTING_ID}/prices`),
    );
  });

  it('asks for a listing before saving anything, and the error is there as the focus lands', async () => {
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Open on Saturday' }));
    const all = screen.getByRole('checkbox', { name: 'All of these listings' });
    let describedOnFocus: string | null = null;
    all.addEventListener('focus', () => {
      describedOnFocus = all.getAttribute('aria-describedby');
    });
    await userEvent.click(copyButton());
    await waitFor(() => expect(all).toHaveFocus());
    expect(describedOnFocus).toBe('copy-hours-all-error');
    expect(all).toHaveAccessibleDescription('Choose at least one listing');
    expect(await screen.findByText('1 field needs your attention')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a week with no day open before it reaches the server', async () => {
    show();
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await userEvent.click(screen.getByRole('checkbox', { name: `Open on ${day}` }));
    }
    await userEvent.click(screen.getByRole('checkbox', { name: 'Harbour lot' }));
    await userEvent.click(copyButton());
    expect(await screen.findByText('Choose at least one day you’re open')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it('tells unnamed drafts apart by number', () => {
    show(WEEKDAYS_ONLY, [
      { id: PIRAEUS, name: null, contentLocale: 'el' },
      { id: HARBOUR, name: null, contentLocale: 'el' },
    ]);
    expect(screen.getByRole('checkbox', { name: 'Unnamed listing 1' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Unnamed listing 2' })).toBeInTheDocument();
  });
});
