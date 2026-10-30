import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../testing/axe';
import { Alert, AlertDescription } from './alert';
import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './empty';
import { Input } from './input';
import { Label } from './label';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from './native-select';

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
