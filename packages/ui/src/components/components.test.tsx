import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../testing/axe';
import { Alert, AlertDescription } from './alert';
import { Badge } from './badge';
import { Button } from './button';
import { Calendar } from './calendar';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './empty';
import { Input } from './input';
import { Label } from './label';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from './native-select';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { ScrollArea } from './scroll-area';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';

describe('Button', () => {
  it('renders a native button by default', () => {
    render(<Button>Book</Button>);
    expect(screen.getByRole('button', { name: 'Book' }).tagName).toBe('BUTTON');
  });

  it('keeps link semantics when used asChild', () => {
    render(
      <Button asChild>
        <a href="/el/sign-in">Σύνδεση</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Σύνδεση' });
    expect(link).toHaveAttribute('href', '/el/sign-in');
    expect(link).toHaveClass('inline-flex');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('exposes the disabled state', () => {
    render(<Button disabled>Book</Button>);
    expect(screen.getByRole('button', { name: 'Book' })).toBeDisabled();
  });
});

describe('Label + Input', () => {
  it('associates the label so the field has an accessible name', async () => {
    const { container } = render(
      <form>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" aria-invalid />
      </form>,
    );
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    await expectNoAxeViolations(container);
  });
});

describe('Alert', () => {
  it('is announced to screen readers', () => {
    render(
      <Alert variant="destructive">
        <AlertDescription>Λάθος κωδικός</AlertDescription>
      </Alert>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Λάθος κωδικός');
  });
});

describe('Card', () => {
  it('lets the page choose the heading level', async () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Account</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe('NativeSelect', () => {
  it('is a real, labelled <select> that keeps invalid text readable', async () => {
    const { container } = render(
      <form>
        <Label htmlFor="time">Time</Label>
        <NativeSelect id="time" defaultValue="09:30" aria-invalid>
          <NativeSelectOptGroup label="Morning">
            <NativeSelectOption value="09:00">09:00</NativeSelectOption>
            <NativeSelectOption value="09:30">09:30</NativeSelectOption>
          </NativeSelectOptGroup>
        </NativeSelect>
      </form>,
    );
    const select = screen.getByRole('combobox', { name: 'Time' });
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('09:30');
    // Parkfairy fix: own text colour, so an invalid Field's red does not reach the value.
    expect(select).toHaveClass('text-foreground');
    expect(screen.getByRole('group', { name: 'Morning' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe('Badge', () => {
  it('is plain text by default and can be a link', () => {
    render(
      <>
        <Badge>Covered</Badge>
        <Badge asChild variant="outline">
          <a href="/el/search?area=syntagma">Σύνταγμα</a>
        </Badge>
      </>,
    );
    expect(screen.getByText('Covered').tagName).toBe('SPAN');
    expect(screen.getByRole('link', { name: 'Σύνταγμα' })).toHaveAttribute('data-slot', 'badge');
  });
});

describe('Empty', () => {
  it('renders its title and description as content', async () => {
    const { container } = render(
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No parking available</EmptyTitle>
          <EmptyDescription>Try another area.</EmptyDescription>
        </EmptyHeader>
      </Empty>,
    );
    expect(screen.getByText('No parking available')).toBeInTheDocument();
    expect(screen.getByText('Try another area.')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe('Calendar', () => {
  const november = new Date(2030, 10, 15);

  it('is a named grid of day buttons, without the disabled days', async () => {
    const { container } = render(
      <Calendar mode="single" defaultMonth={november} disabled={{ before: november }} />,
    );
    const grid = screen.getByRole('grid', { name: 'November 2030' });
    const days = within(grid).getAllByRole('button');
    expect(days.find((day) => day.textContent === '14')).toBeDisabled();
    expect(days.find((day) => day.textContent === '15')).toBeEnabled();
    await expectNoAxeViolations(container);
  });

  it('marks the chosen day so it survives forced-colors mode', () => {
    render(<Calendar mode="single" defaultMonth={november} selected={november} />);
    const chosen = document.querySelector('[data-selected-single=true]');
    expect(chosen).toHaveTextContent('15');
    expect(chosen).toHaveClass('forced-colors:data-[selected-single=true]:outline-solid');
  });
});

describe('ToggleGroup', () => {
  it('offers one choice, shown in forced-colors mode too', async () => {
    const { container } = render(
      <ToggleGroup type="single" role="radiogroup" aria-label="Minutes" defaultValue="30">
        <ToggleGroupItem value="00">00</ToggleGroupItem>
        <ToggleGroupItem value="30">30</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(screen.getByRole('radio', { name: '30' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '30' })).toHaveClass(
      'forced-colors:data-[state=on]:outline-solid',
    );

    await userEvent.click(screen.getByRole('radio', { name: '00' }));

    expect(screen.getByRole('radio', { name: '00' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '30' })).not.toBeChecked();
    await expectNoAxeViolations(container);
  });
});

describe('overlays', () => {
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

  it('Popover opens from its trigger as a dialog and closes on Escape', async () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent aria-label="Details">Inside</PopoverContent>
      </Popover>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Details' })).toHaveTextContent('Inside');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('ScrollArea keeps its content in the document', () => {
    render(
      <ScrollArea className="h-10">
        <p>Long content</p>
      </ScrollArea>,
    );
    expect(screen.getByText('Long content')).toBeInTheDocument();
  });
});
