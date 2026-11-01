import { DEFAULT_TIME_ZONE } from '@parkfairy/contracts/locales';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps, ReactElement } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickMessages } from '@/components/client-messages';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { catalogs, rendererFor } from '@/test/render';
import { DateTimeField } from './date-time-field';
import { StayFields } from './stay-fields';

const calendar = vi.hoisted(() => ({ renders: 0 }));

vi.mock('@parkfairy/ui/components/calendar', async (importOriginal) => {
  const original = await importOriginal<typeof import('@parkfairy/ui/components/calendar')>();
  return {
    ...original,
    Calendar: (props: ComponentProps<typeof original.Calendar>) => {
      calendar.renders += 1;
      return original.Calendar(props);
    },
  };
});

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.searchForm);

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const hours = String(Math.floor(i / 2)).padStart(2, '0');
  return `${hours}:${i % 2 ? '30' : '00'}`;
});

function Field(props: Partial<ComponentProps<typeof DateTimeField>>) {
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
          time="09:00"
          minDate="2030-10-31"
          maxDate="2031-10-31"
          times={TIMES}
          labelledBy="legend"
          {...props}
        />
        <button type="button">Elsewhere</button>
      </form>
    </StayFields>
  );
}

/** Both ends of a stay, 09:00 to 11:00 on the 4th unless a test says otherwise. */
function Stay({ start = '2030-11-04 09:00', end = '2030-11-04 11:00' }) {
  const [startDate = '', startTime = ''] = start.split(' ');
  const [endDate = '', endTime = ''] = end.split(' ');
  const shared = { minDate: '2030-10-31', maxDate: '2031-10-31', times: TIMES };
  return (
    <StayFields>
      <form data-testid="form">
        <span id="from">From</span>
        <DateTimeField
          part="start"
          id="start"
          timeId="start-time"
          dateName="startDate"
          timeName="startTime"
          date={startDate}
          time={startTime}
          labelledBy="from"
          {...shared}
        />
        <span id="until">Until</span>
        <DateTimeField
          part="end"
          id="end"
          timeId="end-time"
          dateName="endDate"
          timeName="endTime"
          date={endDate}
          time={endTime}
          labelledBy="until"
          {...shared}
        />
      </form>
    </StayFields>
  );
}

const submitted = () =>
  Object.fromEntries(new FormData(screen.getByTestId<HTMLFormElement>('form')));

const field = (name = 'From') => screen.getByRole('combobox', { name });

async function open(name?: string) {
  await userEvent.click(field(name));
  // The first press loads the chunk, which can outlast the default on a busy machine.
  return screen.findByRole('dialog', { name: name ?? 'From' }, { timeout: 5000 });
}

const hosts: HTMLElement[] = [];

function serverRender(ui: ReactElement, locale: 'en' | 'el' = 'en') {
  const tree = (
    <NextIntlClientProvider
      locale={locale}
      messages={pickMessages(catalogs[locale], CLIENT_NAMESPACES.searchForm)}
      timeZone={DEFAULT_TIME_ZONE}
    >
      {ui}
    </NextIntlClientProvider>
  );
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = renderToString(tree);
  hosts.push(host);
  return { host, tree };
}

describe('DateTimeField', () => {
  const roots: Root[] = [];
  const hydrate = async (host: HTMLElement, tree: ReactElement) => {
    await act(async () => {
      roots.push(hydrateRoot(host, tree));
      await Promise.resolve();
    });
  };

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
    act(() => roots.splice(0).forEach((root) => root.unmount()));
    hosts.splice(0).forEach((host) => host.remove());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('before the page can run it', () => {
    it('is a native date and time, so the search works without JavaScript', () => {
      const { host } = serverRender(<Field />);

      const date = host.querySelector('input[type=date]');
      expect(date).toHaveAttribute('name', 'startDate');
      expect(date).toHaveAttribute('min', '2030-10-31');
      expect(date).toHaveAttribute('max', '2031-10-31');
      expect(date).toHaveValue('2030-11-04');
      expect(date).toHaveAccessibleName('From Date');

      const time = within(host).getByRole('combobox', { name: 'From Time' });
      expect(time).toHaveAttribute('name', 'startTime');
      expect(time).toHaveValue('09:00');
      expect(within(time).getAllByRole('option')).toHaveLength(48);
      expect(within(time).getByRole('option', { name: '5:30 PM' })).toHaveValue('17:30');
      // Nothing that needs a script: a button that does nothing helps nobody.
      expect(host.querySelector('[aria-haspopup=dialog]')).toBeNull();
    });

    it('keeps the date as the link target of the error summary', () => {
      const { host } = serverRender(<Field id="search-start-date" />);
      expect(host.querySelector('#search-start-date')).toHaveAttribute('type', 'date');
    });

    it('shows Greek times on the 24-hour clock', () => {
      const { host } = serverRender(<Field />, 'el');
      expect(within(host).getByRole('option', { name: '17:30' })).toHaveValue('17:30');
    });
  });

  describe('once the page can run it', () => {
    it('is one field that submits the same values', () => {
      renderInSubtree(<Field />);

      expect(field()).toHaveTextContent('Mon, Nov 4, 2030, 9:00 AM');
      expect(field()).toHaveAttribute('aria-expanded', 'false');
      expect(submitted()).toEqual({ startDate: '2030-11-04', startTime: '09:00' });
      expect(document.querySelector('input[type=date]')).toBeNull();
    });

    it('names the year only when it is not this one', () => {
      const thisYear = new Intl.DateTimeFormat('en', { year: 'numeric' }).format(new Date());
      renderInSubtree(<Field date={`${thisYear}-06-15`} />);
      expect(field()).not.toHaveTextContent(thisYear);
    });

    it('takes along what was entered before it took over', async () => {
      const { host, tree } = serverRender(<Field />);
      const date = host.querySelector('input') as HTMLInputElement;
      const time = host.querySelector('select') as HTMLSelectElement;
      date.value = '2030-11-07';
      time.value = '14:30';

      await hydrate(host, tree);

      expect(submitted()).toEqual({ startDate: '2030-11-07', startTime: '14:30' });
      expect(field()).toHaveTextContent('Thu, Nov 7, 2030, 2:30 PM');
    });

    it('leaves the native fields alone until whoever is using them moves on', async () => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(true); // jsdom says false
      const { host, tree } = serverRender(<Field />);
      const date = host.querySelector('input') as HTMLInputElement;
      const time = host.querySelector('select') as HTMLSelectElement;
      date.focus();

      await hydrate(host, tree);

      expect(host.querySelector('input[type=date]')).toBe(date);
      expect(date).toHaveFocus();

      // Date to time is still inside the field.
      act(() => time.focus());
      expect(host.querySelector('input[type=date]')).toBe(date);
      date.value = '2030-11-09';

      act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
      await waitFor(() => expect(field()).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
      expect(submitted().startDate).toBe('2030-11-09');
    });

    it('keeps them through a switch to another window', async () => {
      const { host, tree } = serverRender(<Field />);
      const date = host.querySelector('input') as HTMLInputElement;
      date.focus();
      await hydrate(host, tree);

      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      fireEvent.focusOut(date);

      expect(host.querySelector('input[type=date]')).toBe(date);
    });

    it('wires its error to the field', async () => {
      renderInSubtree(
        <>
          <Field invalid errorId="start-error" />
          <p id="start-error">Departure must be after arrival</p>
        </>,
      );
      expect(field()).toHaveAttribute('aria-invalid', 'true');
      expect(field()).toHaveAccessibleDescription('Departure must be after arrival');
      await expectNoAxeViolations(document.body);
    });

    it('treats a time off the half-hour grid as the plain list does', () => {
      renderInSubtree(<Field time="09:15" />);

      expect(field()).toHaveTextContent('12:00 AM');
      expect(submitted().startTime).toBe('00:00');
    });

    it('asks for a date when the URL carried nonsense, instead of failing', async () => {
      renderInSubtree(<Field date="nonsense" />);

      expect(field()).toHaveTextContent('Choose a date and time');
      const dialog = await open();
      expect(within(dialog).getByRole('grid', { name: 'October 2030' })).toBeInTheDocument();
    });
  });

  describe('picking', () => {
    it('sets the day, the hour and the half hour in one place', async () => {
      renderInSubtree(<Field />);
      const dialog = await open();
      expect(field()).toHaveAttribute('aria-expanded', 'true');
      expect(field()).toHaveAttribute('aria-controls', dialog.id);

      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Wednesday, November 6, 2030' }),
      );
      await userEvent.click(within(dialog).getByRole('radio', { name: '2 PM' }));
      await userEvent.click(within(dialog).getByRole('radio', { name: '30' }));

      expect(submitted()).toEqual({ startDate: '2030-11-06', startTime: '14:30' });
      expect(field()).toHaveTextContent('Wed, Nov 6, 2030, 2:30 PM');
      expect(dialog).toBeVisible(); // stays open: nobody picks all three at once
    });

    it('opens on the chosen day with the keyboard focus on it', async () => {
      renderInSubtree(<Field />);
      const dialog = await open();
      await waitFor(() =>
        expect(
          within(dialog).getByRole('button', { name: 'Monday, November 4, 2030, selected' }),
        ).toHaveFocus(),
      );
    });

    it('offers only the days a stay can start on', async () => {
      renderInSubtree(<Field />);
      const dialog = await open();

      expect(
        within(dialog).getByRole('button', { name: 'Wednesday, October 30, 2030' }),
      ).toBeDisabled();
      expect(
        within(dialog).getByRole('button', { name: 'Thursday, October 31, 2030' }),
      ).toBeEnabled();
    });

    it('stops at the last bookable day', async () => {
      renderInSubtree(<Field maxDate="2030-11-20" />);
      const dialog = await open();

      expect(
        within(dialog).getByRole('button', { name: 'Wednesday, November 20, 2030' }),
      ).toBeEnabled();
      expect(
        within(dialog).getByRole('button', { name: 'Thursday, November 21, 2030' }),
      ).toBeDisabled();
      expect(within(dialog).getByRole('button', { name: 'Next month' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });

    it('opens with the Down Arrow, as a combobox does', async () => {
      renderInSubtree(<Field />);
      act(() => field().focus());

      await userEvent.keyboard('{ArrowDown}');

      expect(await screen.findByRole('dialog', { name: 'From' })).toBeVisible();
    });

    it('says which day is chosen, on the button the focus lands on', async () => {
      renderInSubtree(<Field />);
      const dialog = await open();
      expect(
        within(dialog).getByRole('button', { name: 'Monday, November 4, 2030, selected' }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole('button', { name: 'Tuesday, November 5, 2030' }),
      ).toBeInTheDocument();
    });

    it('keeps the calendar in place while the time changes', async () => {
      renderInSubtree(<Field />);
      const dialog = await open();
      const grid = within(dialog).getByRole('grid');
      const renders = calendar.renders;

      await userEvent.click(within(dialog).getByRole('radio', { name: '2 PM' }));

      expect(within(dialog).getByRole('grid')).toBe(grid);
      // Not even a render: it is most of the work, and an arrow key is a change of time too.
      expect(calendar.renders).toBe(renders);
    });

    it('keeps the time when the day is picked after it', async () => {
      renderInSubtree(<Field />);
      const dialog = await open();

      await userEvent.click(within(dialog).getByRole('radio', { name: '2 PM' }));
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Wednesday, November 6, 2030' }),
      );

      expect(submitted()).toEqual({ startDate: '2030-11-06', startTime: '14:00' });
    });

    it.each([
      // The earliest and latest zones there are, either side of Athens.
      ['Pacific/Kiritimati', -840],
      ['Pacific/Pago_Pago', 660],
    ])('keeps the day the visitor pressed from %s', async (zone, offset) => {
      vi.stubEnv('TZ', zone);
      expect(new Date('2030-11-08T12:00:00Z').getTimezoneOffset()).toBe(offset);
      renderInSubtree(<Field />);
      const dialog = await open();

      const friday = within(dialog).getByRole('button', { name: 'Friday, November 8, 2030' });
      expect(friday).toHaveTextContent(/^8$/); // the cell that says 8 is the one named the 8th
      await userEvent.click(friday);

      expect(submitted().startDate).toBe('2030-11-08');
    });

    it('does not let the chosen hour be unchosen', async () => {
      renderInSubtree(<Field />);
      const dialog = await open();

      await userEvent.click(within(dialog).getByRole('radio', { name: '9 AM' }));

      expect(submitted().startTime).toBe('09:00');
    });

    it('is one tab stop per column, moved with the arrow keys', async () => {
      renderInSubtree(<Field />);
      const dialog = await open();
      const day = within(dialog).getByRole('button', {
        name: 'Monday, November 4, 2030, selected',
      });
      await waitFor(() => expect(day).toHaveFocus());

      // The minutes are one Tab past the hours, not 24.
      await userEvent.tab();
      await waitFor(() =>
        expect(within(dialog).getByRole('radio', { name: '9 AM' })).toHaveFocus(),
      );
      await userEvent.tab();
      await waitFor(() => expect(within(dialog).getByRole('radio', { name: '00' })).toHaveFocus());

      await userEvent.tab({ shift: true });
      await waitFor(() =>
        expect(within(dialog).getByRole('radio', { name: '9 AM' })).toHaveFocus(),
      );
      await userEvent.keyboard('{ArrowDown}');
      const ten = within(dialog).getByRole('radio', { name: '10 AM' });
      await waitFor(() => expect(ten).toHaveFocus());

      // Reaching a radio chooses it.
      expect(ten).toBeChecked();
      expect(submitted().startTime).toBe('10:00');
    });

    it('marks the chosen hour and half hour', async () => {
      renderInSubtree(<Field time="17:30" />);
      const dialog = await open();

      expect(within(dialog).getByRole('radio', { name: '5 PM' })).toBeChecked();
      expect(within(dialog).getByRole('radio', { name: '30' })).toBeChecked();
      expect(within(dialog).getByRole('radio', { name: '00' })).not.toBeChecked();
    });

    it('goes back to the field on Escape', async () => {
      renderInSubtree(<Field />);
      const dialog = await open();

      await userEvent.keyboard('{Escape}');

      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(field()).toHaveFocus();
      expect(field()).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes when the field is pressed again, rather than reopening', async () => {
      renderInSubtree(<Field />);
      const dialog = await open();

      await userEvent.click(field());

      await waitFor(() => expect(dialog).not.toBeInTheDocument());
    });

    it('leaves the focus where it went when someone clicks away', async () => {
      renderInSubtree(<Field />);
      const dialog = await open();
      const elsewhere = screen.getByRole('button', { name: 'Elsewhere', hidden: true });

      await userEvent.click(elsewhere);

      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(field()).not.toHaveFocus();
    });

    it('has no accessibility violations while open', async () => {
      renderInSubtree(<Field />);
      await open();
      await expectNoAxeViolations(document.body);
    });
  });

  describe('a From picked past Until', () => {
    const pickDay = (dialog: HTMLElement, name: string) =>
      userEvent.click(within(dialog).getByRole('button', { name }));
    const pickHour = (dialog: HTMLElement, name: string) =>
      userEvent.click(within(dialog).getByRole('radio', { name }));
    const closed = async (dialog: HTMLElement) => {
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
    };
    // Within the form: the calendar has a status of its own, for the month.
    const said = () => within(screen.getByTestId('form')).getByRole('status');
    const until = () => {
      const { endDate, endTime } = submitted();
      return `${String(endDate)} ${String(endTime)}`;
    };

    it('takes Until along, keeping the length of the stay', async () => {
      renderInSubtree(<Stay />);
      const dialog = await open('From');

      await pickDay(dialog, 'Wednesday, November 6, 2030');

      expect(until()).toBe('2030-11-06 11:00');
      expect(field('Until')).toHaveTextContent('Wed, Nov 6, 2030, 11:00 AM');
    });

    it('moves it for a start equal to Until too, which the server would refuse', async () => {
      renderInSubtree(<Stay />);
      const dialog = await open('From');

      await pickHour(dialog, '11 AM');

      expect(until()).toBe('2030-11-04 13:00');
    });

    it('leaves it alone while From stays before it', async () => {
      renderInSubtree(<Stay />);
      const dialog = await open('From');

      await pickHour(dialog, '10 AM');
      await closed(dialog);

      expect(until()).toBe('2030-11-04 11:00');
      expect(said()).toBeEmptyDOMElement();
    });

    it('carries the stay over midnight and into the next month', async () => {
      renderInSubtree(<Stay start="2030-11-30 09:00" end="2030-11-30 11:00" />);
      const dialog = await open('From');

      await pickHour(dialog, '11 PM');

      expect(until()).toBe('2030-12-01 01:00');
    });

    it('keeps the stay whatever order the day and hour are picked in', async () => {
      renderInSubtree(<Stay />);
      const dialog = await open('From');

      // A later day first, then an earlier hour: still a two-hour stay, not three.
      await pickDay(dialog, 'Wednesday, November 6, 2030');
      await pickHour(dialog, '8 AM');

      expect(until()).toBe('2030-11-06 10:00');
    });

    it('keeps the stay when the arrow keys walk From past Until', async () => {
      renderInSubtree(<Stay />);
      const dialog = await open('From');
      const nine = within(dialog).getByRole('radio', { name: '9 AM' });
      await waitFor(() =>
        expect(
          within(dialog).getByRole('button', { name: 'Monday, November 4, 2030, selected' }),
        ).toHaveFocus(),
      );
      await userEvent.tab();
      await waitFor(() => expect(nine).toHaveFocus());

      await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
      await waitFor(() => expect(submitted().startTime).toBe('14:00'));

      expect(until()).toBe('2030-11-04 16:00');
    });

    it('gives Until back if From returns before it in the same visit', async () => {
      renderInSubtree(<Stay />);
      const dialog = await open('From');

      await pickHour(dialog, '2 PM');
      await pickHour(dialog, '10 AM');
      await closed(dialog);

      expect(until()).toBe('2030-11-04 11:00');
      expect(said()).toBeEmptyDOMElement();
    });

    it('starts from the new stay the next time the picker opens', async () => {
      renderInSubtree(<Stay />);
      let dialog = await open('From');
      await pickHour(dialog, '2 PM');
      await closed(dialog);
      expect(until()).toBe('2030-11-04 16:00');

      dialog = await open('From');
      await pickHour(dialog, '10 AM');
      await closed(dialog);

      // Not back to 11:00: what was moved earlier is what they have now accepted.
      expect(until()).toBe('2030-11-04 16:00');
    });

    it('gives a stay with no length of its own the usual two hours', async () => {
      // The URL of a search the server refused: Until before From.
      renderInSubtree(<Stay start="2030-11-04 10:00" end="2030-11-04 09:00" />);
      const dialog = await open('From');

      await pickHour(dialog, '11 AM');

      expect(until()).toBe('2030-11-04 13:00');
    });

    it('leaves a date the URL mangled for the server to explain', async () => {
      renderInSubtree(<Stay end="nonsense 11:00" />);
      const dialog = await open('From');

      await pickHour(dialog, '2 PM');

      expect(submitted().endDate).toBe(''); // the native date input it came through drops it
      expect(field('Until')).toHaveTextContent('Choose a date and time');
    });

    it('leaves a date too far out to write down', async () => {
      renderInSubtree(<Stay start="9999-12-31 00:00" end="9999-12-31 12:00" />);
      const dialog = await open('From');

      await pickHour(dialog, '11 PM');

      expect(until()).toBe('9999-12-31 12:00');
    });

    it('settles when someone goes straight to Until, and says so', async () => {
      renderInSubtree(<Stay />);
      const dialog = await open('From');
      await pickHour(dialog, '2 PM');

      await userEvent.click(screen.getByRole('combobox', { name: 'Until', hidden: true }));

      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(said()).toHaveTextContent(/^Departure moved to .*4:00 PM$/);
      expect(await screen.findByRole('dialog', { name: 'Until' })).toBeVisible();
    });

    it('settles on a click away, so the next visit starts from the new stay', async () => {
      renderInSubtree(<Stay />);
      let dialog = await open('From');
      await pickHour(dialog, '2 PM');

      await userEvent.click(document.body);

      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(said()).toHaveTextContent(/^Departure moved to .*4:00 PM$/);

      dialog = await open('From');
      await pickHour(dialog, '10 AM');
      expect(until()).toBe('2030-11-04 16:00');
    });

    it('gives a stay of no length at all the usual two hours', async () => {
      renderInSubtree(<Stay start="2030-11-04 10:00" end="2030-11-04 10:00" />);
      const dialog = await open('From');

      await pickHour(dialog, '11 AM');

      expect(until()).toBe('2030-11-04 13:00');
    });

    it('leaves Until alone for a mangled From, then uses two hours once it has a day', async () => {
      renderInSubtree(<Stay start="nonsense 09:00" />);
      const dialog = await open('From');

      await pickHour(dialog, '2 PM');
      expect(until()).toBe('2030-11-04 11:00');

      await userEvent.click(within(dialog).getByRole('button', { name: 'Next month' }));
      await pickDay(dialog, 'Wednesday, November 6, 2030');
      expect(until()).toBe('2030-11-06 16:00');
    });

    it('keeps half hours in the length of the stay', async () => {
      renderInSubtree(<Stay end="2030-11-04 11:30" />);
      const dialog = await open('From');

      await pickHour(dialog, '2 PM');

      expect(until()).toBe('2030-11-04 16:30');
    });

    it.each([
      ['spring', '2031-03-30 00:00', '2031-03-30 02:00', '2 AM', '2031-03-30 04:00'],
      ['autumn', '2031-10-26 01:00', '2031-10-26 03:00', '3 AM', '2031-10-26 05:00'],
    ])('keeps the length on the wall clock over the %s change', async (_, from, to, hour, end) => {
      renderInSubtree(<Stay start={from} end={to} />);
      const dialog = await open('From');

      await pickHour(dialog, hour);

      expect(until()).toBe(end);
    });

    it.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York'])(
      'keeps Until on the Athens clock from %s',
      async (zone) => {
        vi.stubEnv('TZ', zone);
        renderInSubtree(<Stay />);
        const dialog = await open('From');

        await pickHour(dialog, '11 PM');

        expect(until()).toBe('2030-11-05 01:00');
      },
    );

    it('moves nothing when Until is the one picked', async () => {
      renderInSubtree(<Stay />);
      const dialog = await open('Until');

      await pickHour(dialog, '8 AM');

      expect(submitted().startTime).toBe('09:00');
      expect(until()).toBe('2030-11-04 08:00');
    });

    it('says so once From is done, and stops when Until is picked by hand', async () => {
      renderInSubtree(<Stay />);
      let dialog = await open('From');
      await pickHour(dialog, '2 PM');
      await pickHour(dialog, '3 PM');
      // One message for the visit, not one for each step.
      expect(said()).toBeEmptyDOMElement();

      await closed(dialog);

      // In full, unlike the field: nobody sees this one, so "Mon" and "Nov" would only be read out.
      expect(said()).toHaveTextContent(/^Departure moved to Monday, November 4, 2030\b.*5:00 PM$/);
      await expectNoAxeViolations(document.body);

      dialog = await open('Until');
      await pickHour(dialog, '6 PM');

      expect(said()).toBeEmptyDOMElement();
    });

    it('stays quiet through the next visit too, until that one closes', async () => {
      renderInSubtree(<Stay />);
      let dialog = await open('From');
      await pickHour(dialog, '2 PM');
      await closed(dialog);
      expect(said()).toHaveTextContent(/4:00 PM$/);

      dialog = await open('From');
      await pickHour(dialog, '5 PM');
      expect(said()).toBeEmptyDOMElement();

      await closed(dialog);
      expect(said()).toHaveTextContent(/7:00 PM$/);
    });

    it('says so in Greek', async () => {
      renderInSubtree(<Stay />, { locale: 'el' });
      const dialog = await open('From');
      await pickHour(dialog, '14');
      await closed(dialog);

      expect(said()).toHaveTextContent(/^Η αναχώρηση άλλαξε: Δευτέρα 4 Νοεμβρίου 2030\b.*16:00$/);
    });
  });

  describe('in Greek', () => {
    function GreekField(props: Partial<ComponentProps<typeof DateTimeField>>) {
      return <Field {...props} />;
    }

    it('names everything in Greek, with the week starting on Monday', async () => {
      renderInSubtree(<GreekField />, { locale: 'el' });
      await userEvent.click(field('From'));
      const dialog = await screen.findByRole('dialog');

      expect(within(dialog).getByRole('grid', { name: 'Νοέμβριος 2030' })).toBeInTheDocument();
      // Hidden by the library: each day's name already says its weekday.
      const weekdays = within(dialog).getAllByRole('columnheader', { hidden: true });
      expect(weekdays[0]).toHaveAttribute('aria-label', 'Δευτέρα');
      expect(within(dialog).getByRole('button', { name: 'Επόμενος μήνας' })).toBeInTheDocument();
      expect(within(dialog).getByRole('radiogroup', { name: 'Ώρα' })).toBeInTheDocument();
      expect(within(dialog).getByRole('radiogroup', { name: 'Λεπτά' })).toBeInTheDocument();
      expect(within(dialog).getByRole('navigation')).toHaveAccessibleName('Αλλαγή μήνα');
      // Greek text must be read with a Greek voice; the library says en-US by default.
      expect(dialog.querySelector('[data-slot=calendar]')).toHaveAttribute('lang', 'el');
      expect(
        within(dialog).getByRole('button', { name: 'Δευτέρα 4 Νοεμβρίου 2030, επιλεγμένη' }),
      ).toBeInTheDocument();
      // The library's own English labels must not leak through.
      const names = within(dialog)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? '');
      expect(names.filter((name) => /[A-Za-z]/.test(name))).toEqual([]);
    });

    it('uses the 24-hour clock', async () => {
      renderInSubtree(<GreekField time="17:30" />, { locale: 'el' });
      expect(field('From')).toHaveTextContent('17:30');
      await userEvent.click(field('From'));
      const dialog = await screen.findByRole('dialog');

      const hours = within(dialog).getByRole('radiogroup', { name: 'Ώρα' });
      const labels = within(hours)
        .getAllByRole('radio')
        .map((radio) => radio.textContent);
      expect(labels).toHaveLength(24);
      expect(labels.slice(0, 2)).toEqual(['00', '01']);
      expect(labels.at(-1)).toBe('23');
      expect(within(hours).getByRole('radio', { name: '17' })).toBeChecked();
    });

    it('says which day is today', async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIME_ZONE }).format(
        new Date(),
      );
      renderInSubtree(<GreekField date={today} minDate={today} />, { locale: 'el' });
      await userEvent.click(field('From'));
      const dialog = await screen.findByRole('dialog');

      expect(within(dialog).getByRole('button', { name: /^Σήμερα, / })).toBeInTheDocument();
    });
  });
});
