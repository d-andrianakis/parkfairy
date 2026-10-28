import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from './form-field';

describe('FormField', () => {
  it('names the input by its label', () => {
    render(<FormField id="email" label="Email" />);
    expect(screen.getByRole('textbox', { name: 'Email' })).not.toHaveAttribute('aria-invalid');
  });

  it('announces the hint and the error with the field', async () => {
    const { container } = render(
      <FormField
        id="password"
        label="Password"
        type="password"
        hint="At least 10 characters."
        error="Too short"
      />,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('At least 10 characters. Too short');
    await expectNoAxeViolations(container);
  });
});
