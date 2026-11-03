import { updateOwnerProfile } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { routerMock } from '@/test/navigation-mock';
import { answer, profileFixture, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';
import { ProfileForm } from './profile-form';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  updateOwnerProfile: vi.fn(),
}));
const update = vi.mocked(updateOwnerProfile);

const complete = profileFixture({
  kind: 'individual',
  firstName: 'Μαρία',
  lastName: 'Παπαδοπούλου',
  phone: '+30 210 123 4567',
  addressLine: 'Ερμού 1',
  city: 'Αθήνα',
  postalCode: '105 63',
});

describe('ProfileForm', () => {
  beforeEach(() => {
    update.mockReset();
    update.mockResolvedValue(answer({}) as never);
  });

  it('labels everything and passes axe, in Greek too', async () => {
    const { container } = renderInSubtree(
      <ProfileForm profile={profileFixture()} nextHref="/owner/tax" />,
      { locale: 'el' },
    );
    expect(screen.getByRole('radio', { name: 'Ιδιώτης' })).toBeInTheDocument();
    expect(screen.getByLabelText('Τηλέφωνο')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('shows what was saved earlier', () => {
    renderInSubtree(<ProfileForm profile={complete} nextHref="/owner/tax" />);
    expect(screen.getByLabelText('First name')).toHaveValue('Μαρία');
    expect(screen.getByRole('radio', { name: 'An individual' })).toBeChecked();
  });

  it('saves a valid field when the owner leaves it', async () => {
    renderInSubtree(<ProfileForm profile={profileFixture()} nextHref="/owner/tax" />);
    await userEvent.type(screen.getByLabelText('Phone'), '+30 210 123 4567');
    await userEvent.tab();
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ body: { phone: '+30 210 123 4567' } }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('holds on to an unfinished value instead of sending it', async () => {
    renderInSubtree(<ProfileForm profile={profileFixture()} nextHref="/owner/tax" />);
    await userEvent.type(screen.getByLabelText('Phone'), '12');
    await userEvent.tab();
    expect(update).not.toHaveBeenCalled();
  });

  it('saves nothing when a field is left untouched', async () => {
    renderInSubtree(<ProfileForm profile={complete} nextHref="/owner/tax" />);
    await userEvent.click(screen.getByLabelText('Phone'));
    await userEvent.tab();
    expect(update).not.toHaveBeenCalled();
  });

  it('saves the choice of kind straight away', async () => {
    renderInSubtree(<ProfileForm profile={profileFixture()} nextHref="/owner/tax" />);
    await userEvent.click(screen.getByRole('radio', { name: 'A business' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ body: { kind: 'business' } }));
  });

  it('asks a business for its legal name instead of a person’s', async () => {
    renderInSubtree(<ProfileForm profile={profileFixture()} nextHref="/owner/tax" />);
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'A business' }));
    expect(await screen.findByLabelText('Legal name of the business')).toBeInTheDocument();
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
  });

  it('shows errors beside their fields and goes nowhere', async () => {
    renderInSubtree(<ProfileForm profile={profileFixture()} nextHref="/owner/tax" />);
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Phone')).toHaveAccessibleDescription(
        expect.stringContaining('Enter a valid phone number'),
      ),
    );
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('moves on once everything is valid and saved', async () => {
    renderInSubtree(<ProfileForm profile={complete} nextHref="/owner/tax" />);
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/owner/tax'));
    expect(update.mock.calls[0]?.[0].body).toMatchObject({ firstName: 'Μαρία' });
  });

  it('stays put and says why when the save is refused', async () => {
    update.mockResolvedValue(refusal('VALIDATION_FAILED', 400, ['phoneInvalid']) as never);
    renderInSubtree(<ProfileForm profile={complete} nextHref="/owner/tax" />);
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByText('Enter a valid phone number')).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('copes with a network failure', async () => {
    update.mockRejectedValue(new Error('offline'));
    renderInSubtree(<ProfileForm profile={complete} nextHref="/owner/tax" />);
    await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
  });
});
