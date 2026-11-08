import { saveListingHoursExceptions } from '@parkfairy/api-client';
import {
  addDays,
  DEFAULT_TIME_ZONE,
  HOURS_EXCEPTION_AHEAD_DAYS,
  HOURS_EXCEPTIONS_MAX,
  zonedParts,
  type OwnerHoursException,
} from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer, LISTING_ID, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';
import { HoursExceptionsForm } from './hours-exceptions-form';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  saveListingHoursExceptions: vi.fn(),
}));

const save = vi.mocked(saveListingHoursExceptions);
const sent = () => save.mock.calls[0]?.[0].body.exceptions;

// Relative to the real day: the schema reads the clock, and fake timers fight user-event.
const TODAY = zonedParts(new Date(), DEFAULT_TIME_ZONE).date;
const day = (offset: number) => addDays(TODAY, offset);

const closedOn = (startsOn: string, endsOn = startsOn, label: string | null = null) => ({
  label,
  startsOn,
  endsOn,
  hours: null,
  closedHours: null,
});

function show(exceptions: OwnerHoursException[] = [], locale: 'el' | 'en' = 'en') {
  return renderInSubtree(
    <HoursExceptionsForm id={LISTING_ID} exceptions={exceptions} today={TODAY} />,
    { locale },
  );
}

/** Date fields take a whole value at once, as a browser's picker gives them. */
const pick = (label: string, value: string, entry = 1) =>
  fireEvent.change(
    within(screen.getByRole('group', { name: `Period ${entry}` })).getByLabelText(label),
    { target: { value } },
  );
const saveButton = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => {
  vi.clearAllMocks();
  save.mockImplementation(
    async ({ body }) =>
      answer({
        exceptions: body.exceptions.toSorted((a, b) => a.startsOn.localeCompare(b.startsOn)),
      }) as never,
  );
});

describe('HoursExceptionsForm', () => {
  it('starts empty, adds a closed day and says when it is saved', async () => {
    const { container } = show();
    expect(screen.getByText('No closures or special hours yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add dates' }));
    await waitFor(() => expect(screen.getByLabelText('First day')).toHaveFocus());
    pick('First day', day(10));
    await userEvent.click(saveButton());

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0].path).toEqual({ id: LISTING_ID });
    expect(sent()).toEqual([closedOn(day(10))]);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('brings the last day along until it is set later than the first', () => {
    show([closedOn(day(5))]);
    const last = () => screen.getByLabelText('Last day');
    pick('First day', day(8));
    expect(last()).toHaveValue(day(8));
    pick('Last day', day(12));
    pick('First day', day(9));
    expect(last()).toHaveValue(day(12));
    pick('First day', day(14));
    expect(last()).toHaveValue(day(14));
  });

  it('asks for hours only when the day isn’t closed, and sends them', async () => {
    show([closedOn(day(3))]);
    expect(screen.queryByLabelText('Opens')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Open at other hours' }));
    await userEvent.selectOptions(screen.getByLabelText('Opens'), '09:30');
    await userEvent.selectOptions(screen.getByLabelText('Closes'), '24:00');
    await userEvent.type(screen.getByLabelText('Your note for period 1 (optional)'), ' Αργία ');
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(sent()).toEqual([
      {
        label: 'Αργία',
        startsOn: day(3),
        endsOn: day(3),
        hours: { opens: '09:30', closes: '24:00' },
        closedHours: null,
      },
    ]);
  });

  it('closes part of the day, keeping the weekly hours around it', async () => {
    const { container } = show([closedOn(day(3))]);
    await userEvent.click(screen.getByRole('radio', { name: 'Closed for part of the day' }));
    expect(
      screen.getByRole('radio', { name: 'Closed for part of the day' }),
    ).toHaveAccessibleDescription('The weekly hours apply the rest of the day.');
    expect(screen.queryByLabelText('Opens')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Closed from'), '12:00');
    await userEvent.selectOptions(screen.getByLabelText('Closed until'), '15:30');
    await expectNoAxeViolations(container);
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(sent()).toEqual([{ ...closedOn(day(3)), closedHours: { from: '12:00', to: '15:30' } }]);
  });

  it('refuses a closed part that ends before it starts, at its end', async () => {
    show([{ ...closedOn(day(3)), closedHours: { from: '15:00', to: '12:00' } }]);
    expect(screen.getByRole('radio', { name: 'Closed for part of the day' })).toBeChecked();
    await userEvent.click(saveButton());
    const until = screen.getByLabelText('Closed until');
    await waitFor(() => expect(until).toHaveFocus());
    expect(until).toHaveAccessibleDescription('The closed time must end after it starts');
    expect(save).not.toHaveBeenCalled();
  });

  it('never offers midnight as a closing time that comes first', () => {
    show([{ ...closedOn(day(3)), hours: { opens: '08:00', closes: '14:00' } }]);
    const closing = within(screen.getByLabelText('Closes'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(closing[0]).toBe('00:30');
    expect(closing.at(-1)).toBe('24:00');
  });

  it('moves to a closing time before the opening, with the reason, and sends nothing', async () => {
    show([{ ...closedOn(day(3)), hours: { opens: '14:00', closes: '08:00' } }]);
    await userEvent.click(saveButton());
    const closes = screen.getByLabelText('Closes');
    await waitFor(() => expect(closes).toHaveFocus());
    expect(closes).toHaveAccessibleDescription('Closing must come after opening');
    expect(closes).toHaveAttribute('aria-invalid', 'true');
    expect(save).not.toHaveBeenCalled();
  });

  it('shows an overlap on the later dates, where the owner will look', async () => {
    show([closedOn(day(10), day(12)), closedOn(day(12))]);
    await userEvent.click(saveButton());
    const second = within(screen.getByRole('group', { name: 'Period 2' })).getByLabelText(
      'First day',
    );
    await waitFor(() => expect(second).toHaveFocus());
    expect(second).toHaveAccessibleDescription(
      expect.stringContaining('These dates overlap period 1'),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('says how far ahead dates may go, in days', async () => {
    show([closedOn(day(3))]);
    pick('Last day', day(HOURS_EXCEPTION_AHEAD_DAYS + 1));
    await userEvent.click(saveButton());
    expect(
      await screen.findByText(`Choose a date within the next ${HOURS_EXCEPTION_AHEAD_DAYS} days`),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Last day')).toHaveAttribute(
      'max',
      day(HOURS_EXCEPTION_AHEAD_DAYS),
    );
    expect(screen.getByLabelText('First day')).toHaveAttribute('min', TODAY);
  });

  it('asks for dates an entry left empty', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Add dates' }));
    await userEvent.click(saveButton());
    const first = screen.getByLabelText('First day');
    await waitFor(() => expect(first).toHaveFocus());
    expect(first).toHaveAccessibleDescription(expect.stringContaining('Choose a date'));
  });

  it('removes an entry, says so and returns the focus to Add', async () => {
    show([closedOn(day(3)), closedOn(day(5))]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove period 1' }));
    expect(await screen.findByText('Period 1 removed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add dates' })).toHaveFocus());
    expect(screen.getAllByRole('group', { name: /^Period \d+$/ })).toHaveLength(1);
    expect(screen.getByLabelText('First day')).toHaveValue(day(5));
  });

  it('shows what the server kept, soonest first, and forgets “Saved” on the next change', async () => {
    show([closedOn(day(20)), closedOn(day(4))]);
    await userEvent.click(saveButton());
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    const firsts = screen
      .getAllByLabelText('First day')
      .map((input) => (input as HTMLInputElement).value);
    expect(firsts).toEqual([day(4), day(20)]);
    pick('First day', day(6));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('translates a refusal from the server, never showing its text', async () => {
    save.mockResolvedValueOnce(refusal('VALIDATION_FAILED', 400, ['exceptionOverlap']) as never);
    show([closedOn(day(3))]);
    await userEvent.click(saveButton());
    expect(await screen.findByText('These dates overlap another period')).toBeInTheDocument();
    save.mockResolvedValueOnce(refusal('LISTING_NOT_FOUND', 404) as never);
    await userEvent.click(saveButton());
    expect(await screen.findByText('We can’t find that listing.')).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('refuses closing time over bookings, with the way to them (decision #27)', async () => {
    save.mockResolvedValueOnce({
      error: { code: 'LISTING_BOOKED', statusCode: 409, message: 'LISTING_BOOKED', bookings: 2 },
      response: new Response(null, { status: 409 }),
    } as never);
    show([closedOn(day(3))]);
    await userEvent.click(saveButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('2 bookings fall in the time you’re closing');
    expect(within(alert).getByRole('link', { name: 'See the bookings' })).toHaveAttribute(
      'href',
      `/en/owner/listings/${LISTING_ID}/bookings`,
    );
    // Another refusal has no such way out.
    save.mockResolvedValueOnce(refusal('LISTING_NOT_FOUND', 404) as never);
    await userEvent.click(saveButton());
    expect(await screen.findByText('We can’t find that listing.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See the bookings' })).not.toBeInTheDocument();
  });

  it('ignores a second press while the first is saving', async () => {
    let finish: (value: never) => void = () => undefined;
    save.mockImplementationOnce(
      () => new Promise<never>((resolve) => (finish = resolve)) as ReturnType<typeof save>,
    );
    show([closedOn(day(3))]);
    await userEvent.click(saveButton());
    await userEvent.click(saveButton());
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    expect(save).toHaveBeenCalledOnce();
    finish(answer({ exceptions: [closedOn(day(3))] }) as never);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('stops offering more dates at the limit, and says why where the button was', () => {
    show(Array.from({ length: HOURS_EXCEPTIONS_MAX }, (_, index) => closedOn(day(index + 1))));
    expect(screen.queryByRole('button', { name: 'Add dates' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        `You’ve reached ${HOURS_EXCEPTIONS_MAX} periods, the most one listing can have. Remove one to add another.`,
      ),
    ).toBeInTheDocument();
  });

  it('keeps the owner in place after a save made with Enter in a field', async () => {
    show([closedOn(day(4)), closedOn(day(2))]);
    const note = screen.getByLabelText('Your note for period 1 (optional)');
    await userEvent.type(note, 'Απογραφή{Enter}');
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    // The server's order differs, yet nothing on the page was rebuilt under the owner.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toBe(note);
    expect(note).toHaveValue('Απογραφή');
  });

  it('takes the owner to the first problem as the page reads, not as it was found', async () => {
    // The schema finds a missing date before a backwards one; the page shows the backwards
    // one first.
    show([closedOn(day(5), day(3)), closedOn(day(9))]);
    await userEvent.click(screen.getByRole('button', { name: 'Add dates' }));
    await userEvent.click(saveButton());
    const firstProblem = within(screen.getByRole('group', { name: 'Period 1' })).getByLabelText(
      'Last day',
    );
    await waitFor(() => expect(firstProblem).toHaveFocus());
    expect(firstProblem).toHaveAccessibleDescription(
      'The last day must be the same as the first or after it',
    );
  });

  it('names each period with a heading everyone can see', () => {
    show([closedOn(day(3)), closedOn(day(5))]);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Period 1', 'Period 2']);
  });

  it('says which days may be chosen, and lets a period already running keep its first day', () => {
    show([closedOn(day(-3), day(4))]);
    const first = screen.getByLabelText('First day');
    expect(first).toHaveAccessibleDescription(expect.stringMatching(/^Any day from today to /));
    expect(first).toHaveAttribute('min', day(-3));
  });

  it('sends a plain closed day after other hours were tried and given up', async () => {
    show([{ ...closedOn(day(3)), hours: { opens: '08:00', closes: '14:00' } }]);
    await userEvent.click(screen.getByRole('radio', { name: 'Closed for part of the day' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Closed all day' }));
    await userEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(sent()).toEqual([closedOn(day(3))]);
  });

  it('shows saved entries in Greek, notes in the owner’s words', async () => {
    const { container } = show(
      [
        {
          label: 'Παραμονή',
          startsOn: day(2),
          endsOn: day(2),
          hours: { opens: '08:00', closes: '14:00' },
          closedHours: null,
        },
      ],
      'el',
    );
    const entry = screen.getByRole('group', { name: 'Περίοδος 1' });
    expect(within(entry).getByLabelText('Πρώτη ημέρα')).toHaveValue(day(2));
    expect(within(entry).getByRole('radio', { name: 'Ανοιχτά με ειδικό ωράριο' })).toBeChecked();
    expect(within(entry).getByLabelText('Κλείνει')).toHaveValue('14:00');
    expect(within(entry).getByDisplayValue('Παραμονή')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Αποθήκευση' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
