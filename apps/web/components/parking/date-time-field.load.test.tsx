import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { DateTimeField } from './date-time-field';
import { StayFields } from './stay-fields';

// Apart from date-time-field.test.tsx, because the loaded chunk is kept for the page's life:
// these run in order, failure first.
const chunk = vi.hoisted(() => ({ fail: true, gate: Promise.resolve() }));

vi.mock('./date-time-picker', async (importOriginal) => {
  await chunk.gate;
  if (chunk.fail) throw new Error('offline');
  return importOriginal();
});

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.searchForm);

const TIMES = ['09:00', '09:30', '10:00', '10:30'];

function Field() {
  return (
    <StayFields>
      <form data-testid="form">
        <span id="legend">From</span>
        <DateTimeField
          part="start"
          id="start"
          timeId="start-time"
          dateName="startDate"
          timeName="startTime"
          date="2030-11-04"
          time="09:30"
          minDate="2030-10-31"
          maxDate="2031-10-31"
          times={TIMES}
          labelledBy="legend"
        />
      </form>
    </StayFields>
  );
}

const field = () => screen.getByRole('combobox', { name: 'From' });

describe('DateTimeField, while the picker loads', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('goes back to the plain date and time if it cannot load, and says nothing is open', async () => {
    chunk.fail = true;
    renderInSubtree(<Field />);

    await userEvent.click(field());

    const date = await waitFor(() => {
      const input = document.querySelector<HTMLInputElement>('input[type=date]');
      expect(input).not.toBeNull();
      return input as HTMLInputElement;
    });
    expect(date).toHaveValue('2030-11-04');
    expect(date).toHaveFocus();
    expect(document.querySelector('select')).toHaveValue('09:30');
    expect(document.querySelector('[aria-haspopup=dialog]')).toBeNull();
  });

  it('shows it is working, then opens, and a hover that failed costs nothing', async () => {
    chunk.fail = true;
    renderInSubtree(<Field />);
    await userEvent.hover(field()); // fails quietly; the field stays
    expect(field()).toHaveAttribute('aria-expanded', 'false');

    let release = () => {};
    chunk.gate = new Promise((resolve) => {
      release = resolve;
    });
    chunk.fail = false;
    await userEvent.click(field());

    expect(field()).toHaveAttribute('aria-busy', 'true');
    expect(field()).toHaveAttribute('aria-expanded', 'false');

    release();

    // A real import of the chunk, which can outlast the default on a busy machine.
    const dialog = await screen.findByRole('dialog', { name: 'From' }, { timeout: 5000 });
    expect(dialog).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(field()).not.toHaveAttribute('aria-busy');
  });
});
