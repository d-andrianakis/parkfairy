import {
  cancelMyBooking,
  confirmMyBooking,
  payForMyBooking,
  settleMyPayment,
} from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer, refusal } from '@/test/owner-fixtures';
import { routerMock } from '@/test/navigation-mock';
import { rendererFor } from '@/test/render';
import { ConfirmBooking } from './confirm-booking';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  confirmMyBooking: vi.fn(),
  cancelMyBooking: vi.fn(),
  payForMyBooking: vi.fn(),
  settleMyPayment: vi.fn(),
}));
// Stripe's fields are their own test's: here, what they were given.
vi.mock('./payment-step', () => ({
  default: (props: {
    clientSecret: string;
    publishableKey: string;
    amount: string;
    onPaying?: (paying: boolean) => void;
  }) => (
    <section aria-label="Stripe payment">
      {props.clientSecret} {props.publishableKey} {props.amount}
      <button type="button" onClick={() => props.onPaying?.(true)}>
        Pay now
      </button>
    </section>
  ),
}));
const payFor = vi.mocked(payForMyBooking);
const settlePayment = vi.mocked(settleMyPayment);
const confirm = vi.mocked(confirmMyBooking);
const release = vi.mocked(cancelMyBooking);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.booking);

const ID = 'b0b0b0b0-0000-4000-8000-000000000001';
const AGAIN = '/parking/ermou-garage?startDate=2026-12-10&startTime=10:00';
const show = (locale: 'en' | 'el' = 'en') =>
  renderInSubtree(<ConfirmBooking id={ID} chooseAgainHref={AGAIN} space="Α1" spaceLocale="el" />, {
    locale,
  });
const plate = () => screen.getByRole('textbox', { name: 'Number plate' });
const confirmButton = () => screen.getByRole('button', { name: 'Confirm booking' });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('ConfirmBooking', () => {
  it('asks for the car, says why, and keeps the focus on the field', async () => {
    const { container } = show();
    expect(plate()).toHaveAccessibleDescription(/IKB-1234/);
    await userEvent.click(confirmButton());
    expect(plate()).toHaveFocus();
    expect(plate()).toHaveAttribute('aria-invalid', 'true');
    expect(plate()).toHaveAccessibleDescription(/Enter the number plate/);
    await waitFor(() =>
      expect(screen.getByText('1 field needs your attention')).toBeInTheDocument(),
    );
    await userEvent.type(plate(), 'Δ-1');
    await userEvent.click(confirmButton());
    expect(plate()).toHaveAccessibleDescription(/as it is on the car/);
    expect(confirm).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('confirms with the plate as typed, and comes back to the booking confirmed', async () => {
    confirm.mockResolvedValue(answer({ id: ID, status: 'confirmed' }) as never);
    show();
    await userEvent.type(plate(), 'ικβ 1234');
    await userEvent.click(confirmButton());
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(`/bookings/${ID}?done=confirmed`),
    );
    expect(confirm).toHaveBeenCalledWith({ path: { id: ID }, body: { vehiclePlate: 'ικβ 1234' } });
  });

  it('keeps the plate for the next hold in this tab, and forgets it once booked (3.3.7)', async () => {
    confirm.mockResolvedValueOnce(refusal('SPACE_TAKEN') as never);
    const first = show();
    await userEvent.type(plate(), 'ΙΚΒ-1234');
    await userEvent.click(confirmButton());
    await screen.findByRole('alert');
    first.unmount();
    // The next hold's page: the plate is already there.
    confirm.mockResolvedValueOnce(answer({ id: ID, status: 'confirmed' }) as never);
    show();
    await waitFor(() => expect(plate()).toHaveValue('ΙΚΒ-1234'));
    await userEvent.click(confirmButton());
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledOnce());
    expect(sessionStorage.length).toBe(0);
  });

  it('offers another space when this one was taken meanwhile', async () => {
    confirm.mockResolvedValue(refusal('SPACE_TAKEN') as never);
    show();
    await userEvent.type(plate(), 'IKB1234');
    await userEvent.click(confirmButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Someone else has just booked');
    expect(screen.getByRole('link', { name: 'Choose another space' })).toHaveAttribute(
      'href',
      `/en${AGAIN}`,
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('puts the server’s plate refusal on the field', async () => {
    confirm.mockResolvedValue(refusal('VALIDATION_FAILED', 400, ['plateInvalid']) as never);
    show();
    await userEvent.type(plate(), 'IKB1234');
    await userEvent.click(confirmButton());
    await waitFor(() => expect(plate()).toHaveAttribute('aria-invalid', 'true'));
    expect(plate()).toHaveFocus();
  });

  it('asks before letting the space go, then returns to the listing, which says so', async () => {
    release.mockResolvedValue(answer({ id: ID, status: 'released' }) as never);
    const { container } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Let this space go' }));
    expect(release).not.toHaveBeenCalled();
    // The question takes the focus, so it is read, with the space in the owner's language.
    const question = screen.getByText(/Someone else can book it straight away/);
    expect(question).toHaveFocus();
    expect(question.querySelector('[lang="el"]')).toHaveTextContent('Α1');
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, let it go' }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`${AGAIN}&released=1`));
    expect(release).toHaveBeenCalledWith({ path: { id: ID }, body: {} });
  });

  it('marks a Greek label in an English listing as Greek inside the question', async () => {
    renderInSubtree(<ConfirmBooking id={ID} chooseAgainHref={AGAIN} space="Α1" spaceLocale="en" />);
    await userEvent.click(screen.getByRole('button', { name: 'Let this space go' }));
    const question = screen.getByText(/Someone else can book it straight away/);
    const label = within(question).getByText('Α1');
    expect(label).toHaveAttribute('lang', 'el');
    expect(label.parentElement).toHaveAttribute('lang', 'en');
  });

  it('keeps the space on "No", and gives the focus back to the button every time', async () => {
    show();
    for (let n = 0; n < 2; n++) {
      await userEvent.click(screen.getByRole('button', { name: 'Let this space go' }));
      await userEvent.click(screen.getByRole('button', { name: 'No, keep it' }));
      expect(screen.getByRole('button', { name: 'Let this space go' })).toHaveFocus();
    }
    expect(release).not.toHaveBeenCalled();
  });

  it('won’t say "keep it" once the space is being let go', async () => {
    let settle: (value: unknown) => void = () => undefined;
    release.mockReturnValue(new Promise((resolve) => (settle = resolve)) as never);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Let this space go' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, let it go' }));
    const keep = screen.getByRole('button', { name: 'No, keep it' });
    expect(keep).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(keep);
    expect(screen.getByRole('button', { name: 'Letting it go…' })).toBeInTheDocument();
    settle(answer({ id: ID, status: 'released' }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledOnce());
  });

  it('keeps the question when letting go fails, and says why', async () => {
    release.mockResolvedValue(refusal('BOOKING_NOT_FOUND', 404) as never);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Let this space go' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, let it go' }));
    expect(await screen.findByText('We can’t find this booking.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, let it go' })).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('keeps both buttons from a second press while one is busy', async () => {
    let settle: (value: unknown) => void = () => undefined;
    confirm.mockReturnValue(new Promise((resolve) => (settle = resolve)) as never);
    show();
    await userEvent.type(plate(), 'IKB1234');
    await userEvent.click(confirmButton());
    expect(screen.getByRole('button', { name: 'Confirming…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Let this space go' }));
    expect(release).not.toHaveBeenCalled();
    settle(answer({ id: ID }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledOnce());
  });

  it('speaks Greek', async () => {
    show('el');
    expect(screen.getByRole('textbox', { name: 'Αριθμός κυκλοφορίας' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Επιβεβαίωση κράτησης' }));
    expect(
      screen.getByRole('textbox', { name: 'Αριθμός κυκλοφορίας' }),
    ).toHaveAccessibleDescription(/Εισαγάγετε τον αριθμό κυκλοφορίας/);
  });
});

describe('ConfirmBooking, paying (decision #49)', () => {
  const PAYING = { publishableKey: 'pk_test_123', amount: '€4.00' };
  const showPaying = (payment: typeof PAYING | null = PAYING, locale: 'en' | 'el' = 'en') =>
    renderInSubtree(
      <ConfirmBooking
        id={ID}
        chooseAgainHref={AGAIN}
        space="Α1"
        spaceLocale="el"
        checkout="payment"
        payment={payment}
      />,
      { locale },
    );

  it('keeps the plate and opens the payment, the plate fixed from then on', async () => {
    payFor.mockResolvedValue(answer({ clientSecret: 'pi_1_secret_2', status: 'pending' }) as never);
    const { container } = showPaying();
    await userEvent.type(plate(), 'ικβ 1234');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(payFor).toHaveBeenCalledWith({ path: { id: ID }, body: { vehiclePlate: 'ικβ 1234' } });
    const step = await screen.findByRole('region', { name: 'Stripe payment' });
    expect(step).toHaveTextContent('pi_1_secret_2 pk_test_123 €4.00');
    expect(plate()).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).not.toBeInTheDocument();
    // Letting the space go stays on offer.
    expect(screen.getByRole('button', { name: 'Let this space go' })).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('lets the plate be changed before paying, and holds back letting go while paying', async () => {
    payFor.mockResolvedValue(answer({ clientSecret: 'pi_1_secret_2', status: 'pending' }) as never);
    showPaying();
    await userEvent.type(plate(), 'IKB1234');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await screen.findByRole('region', { name: 'Stripe payment' });
    // Going to pay may have kept the hold longer: the page reads its times again.
    expect(routerMock.refresh).toHaveBeenCalled();
    expect(screen.getByText('Kept with this payment.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change the number plate' }));
    expect(plate()).not.toHaveAttribute('readonly');
    expect(plate()).toHaveFocus();
    await userEvent.clear(plate());
    await userEvent.type(plate(), 'ΙΚΒ 9999');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(payFor).toHaveBeenLastCalledWith({
      path: { id: ID },
      body: { vehiclePlate: 'ΙΚΒ 9999' },
    });
    // A payment under way: letting the space go now would only mean a refund.
    await userEvent.click(await screen.findByRole('button', { name: 'Pay now' }));
    const release = screen.getByRole('button', { name: 'Let this space go' });
    expect(release).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(release);
    expect(screen.queryByText(/Someone else can book it straight away/)).not.toBeInTheDocument();
  });

  it('settles a payment already made instead of paying twice', async () => {
    payFor.mockResolvedValue(
      answer({ clientSecret: 'pi_1_secret_2', status: 'succeeded' }) as never,
    );
    settlePayment.mockResolvedValue(answer({}) as never);
    showPaying();
    await userEvent.type(plate(), 'IKB1234');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(`/bookings/${ID}?done=paid`),
    );
    expect(settlePayment).toHaveBeenCalledWith({ path: { id: ID } });
    expect(screen.queryByRole('region', { name: 'Stripe payment' })).not.toBeInTheDocument();
  });

  it('says payments aren’t available, asking nothing, where no Stripe key is set', async () => {
    showPaying(null);
    await userEvent.type(plate(), 'IKB1234');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Payments aren’t available right now. Nothing was charged',
    );
    expect(payFor).not.toHaveBeenCalled();
  });

  it('says why Stripe couldn’t be asked, in Greek too', async () => {
    payFor.mockResolvedValue(refusal('PAYMENT_PROVIDER_ERROR', 503) as never);
    showPaying(PAYING, 'el');
    await userEvent.type(screen.getByRole('textbox', { name: 'Αριθμός κυκλοφορίας' }), 'IKB1234');
    await userEvent.click(screen.getByRole('button', { name: 'Συνέχεια στην πληρωμή' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Οι πληρωμές δεν είναι διαθέσιμες αυτή τη στιγμή',
    );
  });

  it('still checks the plate before asking for a payment', async () => {
    showPaying();
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(plate()).toHaveFocus();
    expect(payFor).not.toHaveBeenCalled();
  });
});
