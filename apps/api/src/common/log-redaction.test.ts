import { describe, expect, it } from 'vitest';
import { redactUrl } from './log-redaction.js';

describe('redactUrl', () => {
  it('drops the position but keeps the rest of the query', () => {
    expect(redactUrl('/v1/parking/search?latitude=37.9755&longitude=23.7348&start=a&end=b')).toBe(
      '/v1/parking/search?latitude=[redacted]&longitude=[redacted]&start=a&end=b',
    );
  });

  it('drops typed addresses and what ties one person’s keystrokes together', () => {
    expect(
      redactUrl(
        '/v1/places/suggestions?q=%CE%95%CF%81%CE%BC%CE%BF%CF%8D%2010&session=0b6f&locale=el',
      ),
    ).toBe('/v1/places/suggestions?q=[redacted]&session=[redacted]&locale=el');
    expect(redactUrl('/v1/places/retrieve?id=dXJu&session=0b6f&locale=en')).toBe(
      '/v1/places/retrieve?id=[redacted]&session=[redacted]&locale=en',
    );
    expect(redactUrl('/v1/places?locale=el&q=Syntagma')).toBe('/v1/places?locale=el&q=[redacted]');
  });

  it('leaves other URLs alone', () => {
    expect(redactUrl('/v1/parking/search?area=syntagma')).toBe('/v1/parking/search?area=syntagma');
  });
});
