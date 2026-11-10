import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import el from '../messages/el.json';
import en from '../messages/en.json';
import { validationArgs } from './validation-args';

describe('validationArgs', () => {
  it('fills the address minimum in, not the password’s', () => {
    const say = (locale: 'en' | 'el', messages: typeof en) =>
      createTranslator({ locale, messages, namespace: 'Validation' })(
        'placeTooShort',
        validationArgs('placeTooShort'),
      );
    expect(say('en', en)).toBe('Type at least 3 characters');
    expect(say('el', el)).toBe('Πληκτρολογήστε τουλάχιστον 3 χαρακτήρες');
    expect(validationArgs('passwordTooShort').min).toBe(10);
  });
});
