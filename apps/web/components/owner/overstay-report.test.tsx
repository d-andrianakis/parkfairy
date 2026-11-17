import { reportOverstay } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { routerMock } from '@/test/navigation-mock';
import { answer, LISTING_ID, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';

import { OverstayReport } from './overstay-report';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  reportOverstay: vi.fn(),
}));
const report = vi.mocked(reportOverstay);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);
const BOOKING = 'b0b0b0b0-0000-4000-8000-000000000001';
const REPORTED = '2026-11-16T10:30:00.000Z';
const NOTE = 'A grey Fiat stayed two hours on.';

const show = (
  props: Partial<Parameters<typeof OverstayReport>[0]> = {},
  locale: 'en' | 'el' = 'en',
) =>
  renderInSubtree(
    <OverstayReport
      listingId={LISTING_ID}
      bookingId={BOOKING}
      reference="K7M4-Q2ZD"
      canReport
      overstay={null}
      noteMax={300}
      {...props}
    />,
    { locale },
  );
const button = (locale: 'en' | 'el' = 'en') =>
  screen.getByRole('button', {
    name: locale === 'en' ? 'Report an overstay (booking K7M4-Q2ZD)' : /Αναφορά υπέρβασης χρόνου/,
  });
const field = (locale: 'en' | 'el' = 'en') =>
  screen.getByRole('textbox', { name: locale === 'en' ? 'What happened?' : 'Τι συνέβη;' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OverstayReport', () => {
  it('offers the report on a stay that can still be reported, naming the booking', async () => {
    const { container } = show();
    expect(button()).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('offers nothing where a report can no longer be made and none was', () => {
    const { container } = show({ canReport: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('opens a form in place, the cursor in the note, saying who is and is not told', async () => {
    const { container } = show();
    await userEvent.click(button());
    expect(field()).toHaveFocus();
    expect(
      screen.getByRole('form', { name: 'Report an overstay for booking K7M4-Q2ZD' }),
    ).toBeVisible();
    expect(
      screen.getByText(/The driver isn’t told, and nothing is charged or refunded/),
    ).toBeVisible();
    // The hint is read with the field, and says how long the note may be.
    expect(field()).toHaveAccessibleDescription(
      'Which car, how long it stayed on, and anything you did. Our team reads this; the driver doesn’t. Up to 300 characters.',
    );
    expect(report).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('asks for a note before sending anything, and puts the focus on the field', async () => {
    const { container } = show();
    await userEvent.click(button());
    await userEvent.type(field(), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Send the report' }));
    expect(field()).toHaveAccessibleDescription(expect.stringContaining('Describe what happened.'));
    expect(field()).toBeInvalid();
    expect(field()).toHaveFocus();
    expect(report).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('sends the note, says it was sent with the focus on that line, and refreshes the list', async () => {
    report.mockResolvedValue(answer({ reportedAt: REPORTED, status: 'open' }) as never);
    show();
    await userEvent.click(button());
    await userEvent.type(field(), NOTE);
    await userEvent.click(screen.getByRole('button', { name: 'Send the report' }));
    const sent = await screen.findByRole('status');
    expect(sent).toHaveTextContent('Report sent. Our team will look into it.');
    expect(sent).toHaveFocus();
    expect(report).toHaveBeenCalledWith({
      path: { id: LISTING_ID, bookingId: BOOKING },
      body: { note: NOTE },
    });
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps that line once the refreshed list has the report', async () => {
    report.mockResolvedValue(answer({ reportedAt: REPORTED, status: 'open' }) as never);
    const { rerender } = show();
    await userEvent.click(button());
    await userEvent.type(field(), NOTE);
    await userEvent.click(screen.getByRole('button', { name: 'Send the report' }));
    await screen.findByRole('status');
    rerender(
      <OverstayReport
        listingId={LISTING_ID}
        bookingId={BOOKING}
        reference="K7M4-Q2ZD"
        canReport={false}
        overstay={{ reportedAt: REPORTED, status: 'open' }}
        noteMax={300}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Report sent.');
    expect(screen.getByRole('status')).toHaveFocus();
  });

  it('sends once however often the button is pressed', async () => {
    let finish: (value: unknown) => void = () => undefined;
    report.mockReturnValue(new Promise((resolve) => (finish = resolve)) as never);
    show();
    await userEvent.click(button());
    await userEvent.type(field(), NOTE);
    const send = screen.getByRole('button', { name: 'Send the report' });
    await userEvent.click(send);
    const sending = await screen.findByRole('button', { name: 'Sending…' });
    expect(sending).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(sending);
    await userEvent.click(sending);
    expect(report).toHaveBeenCalledTimes(1);
    finish(answer({ reportedAt: REPORTED, status: 'open' }));
    await screen.findByRole('status');
  });

  it('says why when it was reported already, and leaves the note to be copied', async () => {
    report.mockResolvedValue(refusal('OVERSTAY_REPORTED') as never);
    show();
    await userEvent.click(button());
    await userEvent.type(field(), NOTE);
    await userEvent.click(screen.getByRole('button', { name: 'Send the report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This booking has been reported already.',
    );
    expect(field()).toHaveValue(NOTE);
    expect(routerMock.refresh).not.toHaveBeenCalled();
    // And it can be sent again once whatever it was is put right.
    expect(screen.getByRole('button', { name: 'Send the report' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it.each([
    ['BOOKING_NOT_ENDED', 'hasn’t ended yet'],
    ['OVERSTAY_TOO_LATE', 'ended too long ago'],
    ['BOOKING_NOT_FOUND', 'We can’t find that booking.'],
  ])('says in words what %s means', async (code, words) => {
    report.mockResolvedValue(refusal(code) as never);
    show();
    await userEvent.click(button());
    await userEvent.type(field(), NOTE);
    await userEvent.click(screen.getByRole('button', { name: 'Send the report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it("says the server's own complaint about the note in the owner's language", async () => {
    report.mockResolvedValue(refusal('VALIDATION_FAILED', 400, ['textTooLong']) as never);
    show();
    await userEvent.click(button());
    await userEvent.type(field(), NOTE);
    await userEvent.click(screen.getByRole('button', { name: 'Send the report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too long/i);
  });

  it('closes the form on "Not now", the note forgotten the focus back on the button', async () => {
    show();
    await userEvent.click(button());
    await userEvent.type(field(), NOTE);
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await waitFor(() => expect(button()).toHaveFocus());
    expect(report).not.toHaveBeenCalled();
  });

  it('says that a report was made, and when, in place of the button', async () => {
    const { container } = show({
      canReport: false,
      overstay: { reportedAt: REPORTED, status: 'open' },
    });
    expect(
      screen.getByText(
        'An overstay was reported on November 16, 2026. Our team will look into it.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('says that it was looked into when staff have closed it, and shows nothing of staff’s note', () => {
    show({ canReport: false, overstay: { reportedAt: REPORTED, status: 'resolved' } });
    expect(
      screen.getByText(
        'An overstay was reported on November 16, 2026. Our team has looked into it and closed the report.',
      ),
    ).toBeVisible();
  });

  it('reads and sends in Greek', async () => {
    report.mockResolvedValue(answer({ reportedAt: REPORTED, status: 'open' }) as never);
    const { container } = show({}, 'el');
    await userEvent.click(button('el'));
    expect(
      screen.getByRole('form', { name: 'Αναφορά υπέρβασης χρόνου για την κράτηση K7M4-Q2ZD' }),
    ).toBeVisible();
    await expectNoAxeViolations(container);
    await userEvent.type(field('el'), 'Ένα γκρι Fiat έμεινε δύο ώρες παραπάνω.');
    await userEvent.click(screen.getByRole('button', { name: 'Αποστολή αναφοράς' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Η αναφορά στάλθηκε.');
  });

  it('tells the owner in Greek that the stay is not over yet', async () => {
    report.mockResolvedValue(refusal('BOOKING_NOT_ENDED') as never);
    show({}, 'el');
    await userEvent.click(button('el'));
    await userEvent.type(field('el'), NOTE);
    await userEvent.click(screen.getByRole('button', { name: 'Αποστολή αναφοράς' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('δεν έχει λήξει ακόμη');
  });
});
