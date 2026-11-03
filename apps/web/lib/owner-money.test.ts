import { describe, expect, it } from 'vitest';
import { moneyText, parseMoney } from './owner-money';

describe('parseMoney', () => {
  it.each([
    ['3', 300],
    ['3,5', 350],
    ['3,50', 350],
    ['3.50', 350],
    ['0,10', 10],
    [' 12,05 ', 1205],
    ['1000', 100_000],
  ])('reads %j', (text, minor) => {
    expect(parseMoney(text)).toBe(minor);
  });

  it('never drifts a cent the way floats do', () => {
    expect(parseMoney('1,15')).toBe(115); // 1.15 * 100 is 114.99999999999999
    expect(parseMoney('4,35')).toBe(435);
    expect(parseMoney('19,99')).toBe(1999);
  });

  it.each(['', 'abc', '3,555', '-3', '1,2,3', '3 50', '€3'])('refuses %j', (text) => {
    expect(parseMoney(text)).toBeNull();
  });
});

describe('moneyText', () => {
  it('uses the decimal mark of the language', () => {
    expect(moneyText(350, 'el')).toBe('3,50');
    expect(moneyText(350, 'en')).toBe('3.50');
  });

  it('keeps two digits of cents', () => {
    expect(moneyText(305, 'en')).toBe('3.05');
    expect(moneyText(300, 'en')).toBe('3.00');
  });

  it('leaves an empty field for nothing saved', () => {
    expect(moneyText(null, 'en')).toBe('');
  });

  it('round-trips', () => {
    for (const minor of [10, 99, 100, 115, 435, 1999, 100_000]) {
      expect(parseMoney(moneyText(minor, 'el'))).toBe(minor);
    }
  });
});
