import { describe, expect, it } from 'vitest';
import { redactUrl } from './log-redaction.js';

describe('redactUrl', () => {
  it('drops the position but keeps the rest of the query', () => {
    expect(redactUrl('/v1/parking/search?latitude=37.9755&longitude=23.7348&start=a&end=b')).toBe(
      '/v1/parking/search?latitude=[redacted]&longitude=[redacted]&start=a&end=b',
    );
  });

  it('leaves other URLs alone', () => {
    expect(redactUrl('/v1/parking/search?area=syntagma')).toBe('/v1/parking/search?area=syntagma');
  });
});
