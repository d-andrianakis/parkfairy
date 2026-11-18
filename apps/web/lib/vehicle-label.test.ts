import { describe, expect, it } from 'vitest';

import { vehicleLabel } from './vehicle-label';

describe('vehicleLabel', () => {
  it('is the nickname and the plate, or the plate alone', () => {
    expect(vehicleLabel({ name: 'Work car', plate: 'IKB1234' })).toBe('Work car · IKB1234');
    expect(vehicleLabel({ name: null, plate: 'IKB1234' })).toBe('IKB1234');
  });
});
