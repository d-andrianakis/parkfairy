import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../testing/axe';
import { Alert, AlertDescription } from './alert';
import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Input } from './input';
import { Label } from './label';

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
