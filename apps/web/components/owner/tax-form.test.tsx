import { saveOwnerTaxDetails } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { routerMock } from '@/test/navigation-mock';
import { answer, profileFixture } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';
import { TaxForm } from './tax-form';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  saveOwnerTaxDetails: vi.fn(),
}));
const save = vi.mocked(saveOwnerTaxDetails);

const individual = profileFixture({ kind: 'individual' });
const business = profileFixture({ kind: 'business' });
const press = () => userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

describe('TaxForm', () => {
  beforeEach(() => {
    save.mockReset();
    save.mockResolvedValue(answer({}) as never);
  });

  it('passes axe', async () => {
    const { container } = renderInSubtree(<TaxForm profile={individual} nextHref="/owner" />);
    await expectNoAxeViolations(container);
  });

  it('asks individuals for a birth date, and businesses for a registration number', () => {
    const { unmount } = renderInSubtree(<TaxForm profile={individual} nextHref="/owner" />);
    expect(screen.getByLabelText('Date of birth')).toBeInTheDocument();
    expect(screen.queryByLabelText('Business registration number')).not.toBeInTheDocument();
    unmount();

    renderInSubtree(<TaxForm profile={business} nextHref="/owner" />);
    expect(screen.getByLabelText('Business registration number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Date of birth')).not.toBeInTheDocument();
  });

  it('says that leaving keeps nothing, because nothing is saved until the button', () => {
    renderInSubtree(<TaxForm profile={individual} nextHref="/owner" />);
    expect(screen.getByRole('link', { name: 'Leave without saving' })).toBeInTheDocument();
    expect(screen.queryByText('Save and finish later')).not.toBeInTheDocument();
  });

  it('saves nothing as it goes: sensitive values wait for the button', async () => {
    renderInSubtree(<TaxForm profile={individual} nextHref="/owner" />);
    await userEvent.type(screen.getByLabelText('Tax number (ΑΦΜ)'), '094259216');
    await userEvent.tab();
    expect(save).not.toHaveBeenCalled();
  });

  it('requires what isn’t saved yet', async () => {
    renderInSubtree(<TaxForm profile={individual} nextHref="/owner" />);
    await press();
    await waitFor(() =>
      expect(screen.getByLabelText('Tax number (ΑΦΜ)')).toHaveAccessibleDescription(
        expect.stringContaining('Enter your tax number'),
      ),
    );
    expect(screen.getByLabelText('Date of birth')).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^2 /));
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a Greek number with the wrong check digit before sending it', async () => {
    renderInSubtree(<TaxForm profile={individual} nextHref="/owner" />);
    await userEvent.type(screen.getByLabelText('Tax number (ΑΦΜ)'), '123456789');
    await press();
    await waitFor(() =>
      expect(screen.getByLabelText('Tax number (ΑΦΜ)')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('drops the Greek check for other countries', async () => {
    renderInSubtree(<TaxForm profile={individual} nextHref="/owner" />);
    await userEvent.selectOptions(
      screen.getByLabelText('Country that issued your tax number'),
      'CY',
    );
    expect(screen.getByLabelText('Tax number')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Tax number'), 'CY12345678L');
    await userEvent.type(screen.getByLabelText('Date of birth'), '1980-02-03');
    await press();
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
  });

  it('shows the end of a saved number, and never fills the field with it', () => {
    const saved = profileFixture({
      kind: 'individual',
      tax: {
        taxCountry: 'GR',
        taxIdEnding: '216',
        vatIdEnding: null,
        registrationEnding: null,
        birthDateSaved: true,
      },
    });
    renderInSubtree(<TaxForm profile={saved} nextHref="/owner" />);
    expect(screen.getByLabelText('Tax number (ΑΦΜ)')).toHaveValue('');
    expect(screen.getByText('Saved, ending 216. Leave empty to keep it.')).toBeInTheDocument();
  });

  it('lets saved details stand without retyping them', async () => {
    const saved = profileFixture({
      kind: 'individual',
      tax: {
        taxCountry: 'GR',
        taxIdEnding: '216',
        vatIdEnding: null,
        registrationEnding: null,
        birthDateSaved: true,
      },
    });
    renderInSubtree(<TaxForm profile={saved} nextHref="/owner" />);
    await press();
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/owner'));
  });
});
