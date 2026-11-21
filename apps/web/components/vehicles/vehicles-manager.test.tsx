import {
  changeMyVehicle,
  forgetMyVehicle,
  type SavedVehicle,
  saveMyVehicle,
} from '@parkfairy/api-client';
import { VEHICLE_LIMITS } from '@parkfairy/contracts/validation';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { answer, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';

import { VehiclesManager } from './vehicles-manager';

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  saveMyVehicle: vi.fn(),
  changeMyVehicle: vi.fn(),
  forgetMyVehicle: vi.fn(),
}));
const save = vi.mocked(saveMyVehicle);
const change = vi.mocked(changeMyVehicle);
const forget = vi.mocked(forgetMyVehicle);
const renderInSubtree = rendererFor(CLIENT_NAMESPACES.vehicles);

const vehicle = (id: string, plate: string, extra: Partial<SavedVehicle> = {}): SavedVehicle => ({
  id,
  plate,
  name: null,
  heightCm: null,
  lengthCm: null,
  widthCm: null,
  ...extra,
});
const WORK = vehicle('a0a0a0a0-0000-4000-8000-000000000001', 'IKB1234', {
  name: 'Work car',
  heightCm: 190,
  lengthCm: 440,
});
const SPARE = vehicle('a0a0a0a0-0000-4000-8000-000000000002', 'YZM5678');

const show = (initial: SavedVehicle[], locale: 'en' | 'el' = 'en') =>
  renderInSubtree(<VehiclesManager initial={initial} />, { locale });
const adding = () => {
  const form = screen.getByRole('region', { name: 'Add a vehicle' });
  return {
    form,
    plate: within(form).getByRole('textbox', { name: 'Number plate' }),
    name: within(form).getByRole('textbox', { name: 'Name (optional)' }),
    height: within(form).getByRole('textbox', { name: 'Height (cm)' }),
    length: within(form).getByRole('textbox', { name: 'Length (cm)' }),
    width: within(form).getByRole('textbox', { name: 'Width (cm)' }),
    submit: within(form).getByRole('button', { name: 'Save vehicle' }),
  };
};

/** What the page's status regions say: each form has one for its own errors, the page has one more. */
const said = () =>
  screen
    .getAllByRole('status')
    .map((region) => region.textContent)
    .join(' ');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VehiclesManager (5A.2)', () => {
  it('lists each vehicle with its plate, its name and what is said of its size', async () => {
    const { container } = show([WORK, SPARE]);
    const list = screen.getByRole('list', { name: 'Your saved vehicles' });
    const [work, spare] = within(list).getAllByRole('listitem');
    expect(work).toHaveTextContent('IKB1234');
    expect(work).toHaveTextContent('Work car');
    expect(work).toHaveTextContent('190 cm high, 440 cm long');
    expect(spare).toHaveTextContent('YZM5678');
    expect(spare).toHaveTextContent('No size given');
    // The driver's own words are isolated, so a name in another script keeps its order.
    expect(within(work as HTMLElement).getByText('Work car').tagName).toBe('BDI');
    await expectNoAxeViolations(container);
  });

  it('says there is nothing yet, and offers the form', () => {
    show([]);
    expect(screen.getByText('You haven’t saved a vehicle yet.')).toBeInTheDocument();
    expect(adding().submit).toBeInTheDocument();
  });

  it('shows the numbers in the language of the page', () => {
    show([vehicle('a0a0a0a0-0000-4000-8000-000000000003', 'ΙΚΒ1234', { heightCm: 1900 })], 'el');
    expect(screen.getByText('ύψος 1.900 εκ.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Προσθήκη οχήματος' })).toBeInTheDocument();
  });

  describe('adding one', () => {
    it('asks for a readable plate, says how many fields need attention, and sends nothing', async () => {
      show([]);
      const { plate, submit, height, name } = adding();
      await userEvent.click(submit);
      expect(plate).toHaveFocus();
      expect(plate).toHaveAttribute('aria-invalid', 'true');
      expect(plate).toHaveAccessibleDescription(/Enter the number plate/);
      await waitFor(() =>
        expect(screen.getByText('1 field needs your attention')).toBeInTheDocument(),
      );
      await userEvent.type(plate, 'Δ-1');
      await userEvent.type(height, '99');
      await userEvent.type(name, 'x'.repeat(41));
      await userEvent.click(submit);
      expect(plate).toHaveAccessibleDescription(/as it is on the car/);
      expect(name).toHaveAccessibleDescription(/Use at most 40 characters/);
      // Each size says its own limits.
      expect(height).toHaveAccessibleDescription('Enter a height from 100 to 500 cm');
      expect(save).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByText('3 fields need your attention')).toBeInTheDocument(),
      );
    });

    it('sends the plate as typed with the sizes as numbers, then lists it and says so', async () => {
      save.mockResolvedValue(
        answer({ vehicles: [WORK] }) as unknown as Awaited<ReturnType<typeof saveMyVehicle>>,
      );
      show([]);
      const { plate, name, height, length, submit } = adding();
      await userEvent.type(plate, 'ικβ-1234');
      await userEvent.type(name, ' Work car ');
      await userEvent.type(height, '190');
      await userEvent.type(length, '440');
      await userEvent.click(submit);
      await waitFor(() =>
        expect(save).toHaveBeenCalledWith({
          body: {
            plate: 'ικβ-1234',
            name: 'Work car',
            heightCm: 190,
            lengthCm: 440,
            widthCm: null,
          },
        }),
      );
      const list = await screen.findByRole('list', { name: 'Your saved vehicles' });
      expect(within(list).getByText('IKB1234')).toBeInTheDocument();
      await waitFor(() => expect(said()).toContain('Vehicle saved.'));
      // Emptied and ready for the next one, with the focus back on the plate.
      expect(adding().plate).toHaveValue('');
      expect(adding().plate).toHaveFocus();
    });

    it('sends no name for a name left empty', async () => {
      save.mockResolvedValue(
        answer({ vehicles: [SPARE] }) as unknown as Awaited<ReturnType<typeof saveMyVehicle>>,
      );
      show([]);
      await userEvent.type(adding().plate, 'YZM 5678');
      await userEvent.click(adding().submit);
      await waitFor(() => expect(save).toHaveBeenCalledOnce());
      expect(save.mock.calls[0]?.[0]).toEqual({
        body: { plate: 'YZM 5678', name: null, heightCm: null, lengthCm: null, widthCm: null },
      });
    });

    it('says at the plate that it is saved already', async () => {
      save.mockResolvedValue(refusal('VEHICLE_EXISTS') as never);
      show([SPARE]);
      await userEvent.type(adding().plate, 'YZM5678');
      await userEvent.click(adding().submit);
      await waitFor(() =>
        expect(adding().plate).toHaveAccessibleDescription(/saved that plate already/),
      );
      expect(adding().plate).toHaveFocus();
    });

    it('says what went wrong when it is not about a field, and keeps what was typed', async () => {
      save.mockResolvedValue(refusal('VEHICLE_LIMIT_REACHED') as never);
      show([]);
      await userEvent.type(adding().plate, 'IKB1234');
      await userEvent.click(adding().submit);
      expect(await screen.findByRole('alert')).toHaveTextContent('saved the most vehicles');
      expect(adding().plate).toHaveValue('IKB1234');
      save.mockResolvedValue({ error: {}, response: new Response(null, { status: 500 }) } as never);
      await userEvent.click(adding().submit);
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'),
      );
    });

    it('offers no form once the most is saved, and says why', () => {
      const many = Array.from({ length: VEHICLE_LIMITS.perDriver }, (_, index) =>
        vehicle(
          `a0a0a0a0-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
          `AB${1000 + index}`,
        ),
      );
      show(many);
      expect(screen.getByText(/saved the most vehicles you can \(10\)/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save vehicle' })).not.toBeInTheDocument();
    });
  });

  describe('changing one', () => {
    it('opens on the plate with what is saved, and puts the focus back on the button', async () => {
      change.mockResolvedValue(
        answer({ vehicles: [{ ...WORK, name: 'Old car' }] }) as unknown as Awaited<
          ReturnType<typeof changeMyVehicle>
        >,
      );
      show([WORK]);
      await userEvent.click(screen.getByRole('button', { name: 'Edit Work car · IKB1234' }));
      const form = screen.getByRole('form', { name: 'Change Work car · IKB1234' });
      const plate = within(form).getByRole('textbox', { name: 'Number plate' });
      expect(plate).toHaveFocus();
      expect(plate).toHaveValue('IKB1234');
      expect(within(form).getByRole('textbox', { name: 'Height (cm)' })).toHaveValue('190');
      const name = within(form).getByRole('textbox', { name: 'Name (optional)' });
      await userEvent.clear(name);
      await userEvent.type(name, 'Old car');
      await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(change).toHaveBeenCalledWith({
          path: { id: WORK.id },
          body: {
            plate: 'IKB1234',
            name: 'Old car',
            heightCm: 190,
            lengthCm: 440,
            widthCm: null,
          },
        }),
      );
      const edit = await screen.findByRole('button', { name: 'Edit Old car · IKB1234' });
      expect(edit).toHaveFocus();
      await waitFor(() => expect(said()).toContain('Changes saved.'));
    });

    it('clears a size that is emptied', async () => {
      change.mockResolvedValue(
        answer({ vehicles: [WORK] }) as unknown as Awaited<ReturnType<typeof changeMyVehicle>>,
      );
      show([WORK]);
      await userEvent.click(screen.getByRole('button', { name: /^Edit/ }));
      const form = screen.getByRole('form', { name: /^Change/ });
      await userEvent.clear(within(form).getByRole('textbox', { name: 'Height (cm)' }));
      await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(change).toHaveBeenCalledOnce());
      expect(change.mock.calls[0]?.[0]).toMatchObject({ body: { heightCm: null, lengthCm: 440 } });
    });

    it('says at the plate that the one it was changed to is saved already, and is accessible open', async () => {
      change.mockResolvedValue(refusal('VEHICLE_EXISTS') as never);
      const { container } = show([WORK, SPARE]);
      await userEvent.click(screen.getByRole('button', { name: 'Edit Work car · IKB1234' }));
      const form = screen.getByRole('form', { name: 'Change Work car · IKB1234' });
      const plate = within(form).getByRole('textbox', { name: 'Number plate' });
      await userEvent.clear(plate);
      await userEvent.type(plate, 'YZM5678');
      await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(plate).toHaveAccessibleDescription(/saved that plate already/));
      expect(plate).toHaveFocus();
      await expectNoAxeViolations(container);
    });

    it('leaves it as it was on Cancel, with the focus back', async () => {
      show([WORK]);
      await userEvent.click(screen.getByRole('button', { name: /^Edit/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(change).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /^Edit/ })).toHaveFocus();
    });
  });

  describe('where the focus goes', () => {
    it('stays in the form just opened after another was cancelled, not pulled back to the first', async () => {
      show([WORK, SPARE]);
      await userEvent.click(screen.getByRole('button', { name: 'Edit Work car · IKB1234' }));
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('button', { name: 'Edit Work car · IKB1234' })).toHaveFocus();
      await userEvent.click(screen.getByRole('button', { name: 'Edit YZM5678' }));
      const form = screen.getByRole('form', { name: 'Change YZM5678' });
      await waitFor(() =>
        expect(within(form).getByRole('textbox', { name: 'Number plate' })).toHaveFocus(),
      );
    });

    it('comes back to the button each time "No, keep it" is pressed, not only the first', async () => {
      show([WORK]);
      for (let round = 0; round < 2; round++) {
        await userEvent.click(screen.getByRole('button', { name: 'Remove Work car · IKB1234' }));
        await userEvent.click(screen.getByRole('button', { name: 'No, keep it' }));
        expect(
          screen.getByRole('button', { name: 'Remove Work car · IKB1234' }),
        ).toBeInTheDocument();
        expect(document.body).not.toHaveFocus();
      }
    });

    it('says a second save in a row too, and puts the focus on the list when the last one fits', async () => {
      const nine = Array.from({ length: VEHICLE_LIMITS.perDriver - 1 }, (_, index) =>
        vehicle(
          `a0a0a0a0-0000-4000-8000-0000000003${String(index).padStart(2, '0')}`,
          `AB${2000 + index}`,
        ),
      );
      const tenth = [...nine, SPARE];
      save.mockResolvedValue(
        answer({ vehicles: tenth }) as unknown as Awaited<ReturnType<typeof saveMyVehicle>>,
      );
      show(nine);
      await userEvent.type(adding().plate, 'YZM 5678');
      await userEvent.click(adding().submit);
      await waitFor(() => expect(said()).toContain('Vehicle saved.'));
      expect(screen.queryByRole('button', { name: 'Save vehicle' })).toBeNull();
      expect(screen.getByRole('heading', { name: 'Your saved vehicles' })).toHaveFocus();
    });

    it('empties the status before a repeat, so it is announced again', async () => {
      save.mockResolvedValue(
        answer({ vehicles: [WORK] }) as unknown as Awaited<ReturnType<typeof saveMyVehicle>>,
      );
      show([]);
      await userEvent.type(adding().plate, 'IKB1234');
      await userEvent.click(adding().submit);
      await waitFor(() => expect(said()).toContain('Vehicle saved.'));
      await userEvent.type(adding().plate, 'YZM5678');
      await userEvent.click(adding().submit);
      // Between the two the region was empty: that is what a screen reader reacts to.
      await waitFor(() => expect(said()).toContain('Vehicle saved.'));
      expect(save).toHaveBeenCalledTimes(2);
    });
  });

  describe('removing one', () => {
    it('asks first, with the question focused, and "No, keep it" goes back', async () => {
      show([WORK]);
      await userEvent.click(screen.getByRole('button', { name: 'Remove Work car · IKB1234' }));
      const question = screen.getByText(/Remove Work car · IKB1234\? Bookings you made with it/);
      expect(question).toHaveFocus();
      await userEvent.click(screen.getByRole('button', { name: 'No, keep it' }));
      expect(forget).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Remove Work car · IKB1234' })).toBeInTheDocument();
    });

    it('removes it, says so, and puts the focus on the list’s heading', async () => {
      forget.mockResolvedValue(
        answer({ vehicles: [SPARE] }) as unknown as Awaited<ReturnType<typeof forgetMyVehicle>>,
      );
      show([WORK, SPARE]);
      await userEvent.click(screen.getByRole('button', { name: 'Remove Work car · IKB1234' }));
      await userEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }));
      await waitFor(() => expect(forget).toHaveBeenCalledWith({ path: { id: WORK.id } }));
      await waitFor(() => expect(said()).toContain('Vehicle removed.'));
      expect(screen.queryByText('IKB1234')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Your saved vehicles' })).toHaveFocus();
    });

    it('says when it could not be removed, and keeps the vehicle', async () => {
      forget.mockResolvedValue(refusal('VEHICLE_NOT_FOUND', 404) as never);
      show([WORK]);
      await userEvent.click(screen.getByRole('button', { name: 'Remove Work car · IKB1234' }));
      await userEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('no longer saved');
      expect(screen.getByText('IKB1234')).toBeInTheDocument();
    });
  });
});
