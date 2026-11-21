import { setMyReminders } from '@parkfairy/api-client';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';

import { ReminderSetting } from './reminder-setting';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  setMyReminders: vi.fn(),
}));
const save = vi.mocked(setMyReminders);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.account);
const box = () => screen.getByRole('checkbox', { name: /Email me before a stay starts/ });
const said = () =>
  screen
    .getAllByRole('status')
    .map((region) => region.textContent)
    .join(' ');

beforeEach(() => vi.clearAllMocks());

describe('ReminderSetting (5A.3)', () => {
  it('is on as the account has it, and says what the two emails are', async () => {
    const { container } = renderInSubtree(<ReminderSetting initial />);
    expect(box()).toBeChecked();
    expect(screen.getByText(/about two hours before you arrive/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('saves as it is pressed, and says what it is now', async () => {
    save.mockResolvedValue(answer({ reminderEmails: false }) as never);
    renderInSubtree(<ReminderSetting initial />);
    await userEvent.click(box());
    await waitFor(() => expect(save).toHaveBeenCalledWith({ body: { reminderEmails: false } }));
    expect(box()).not.toBeChecked();
    await waitFor(() => expect(said()).toContain('Reminders are off.'));
    save.mockResolvedValue(answer({ reminderEmails: true }) as never);
    await userEvent.click(box());
    await waitFor(() => expect(said()).toContain('Reminders are on.'));
    expect(box()).toBeChecked();
  });

  it('puts the box back and says so when it could not save', async () => {
    save.mockResolvedValue(refusal('X', 500) as never);
    renderInSubtree(<ReminderSetting initial />);
    await userEvent.click(box());
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t save that.');
    expect(box()).toBeChecked();
  });

  it('speaks Greek', () => {
    renderInSubtree(<ReminderSetting initial={false} />, { locale: 'el' });
    expect(screen.getByRole('checkbox', { name: /Στείλτε μου email πριν/ })).not.toBeChecked();
  });
});
