import { describe, expect, it } from 'vitest';
import el from './el.json';
import en from './en.json';
import { ERROR_FALLBACK } from './error-fallback';

describe('ERROR_FALLBACK', () => {
  it('is exactly the catalogs’ Error namespace (the catalogs are the source of truth)', () => {
    expect(ERROR_FALLBACK).toEqual({ el: el.Error, en: en.Error });
  });
});
