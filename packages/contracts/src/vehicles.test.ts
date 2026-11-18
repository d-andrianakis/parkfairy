import { describe, expect, it } from 'vitest';

import {
  FavouriteListSchema,
  FAVOURITES_MAX,
  isValidationMessage,
  SavedVehicleInputSchema,
  SavedVehicleListSchema,
  VEHICLE_ERROR_CODES,
  VEHICLE_LIMITS,
} from './index.js';

function issues(result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return result.error?.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`) ?? [];
}

describe('SavedVehicleInputSchema (5A.2)', () => {
  it('takes a plate alone, and keeps it as typed for the API to normalize', () => {
    expect(SavedVehicleInputSchema.parse({ plate: ' ΙΚΒ-1234 ' })).toEqual({ plate: 'ΙΚΒ-1234' });
  });

  it('takes a nickname and sizes in centimetres, and leaves out what is empty', () => {
    expect(
      SavedVehicleInputSchema.parse({
        plate: 'IKB1234',
        name: ' Work car ',
        heightCm: 190,
        lengthCm: null,
      }),
    ).toEqual({ plate: 'IKB1234', name: 'Work car', heightCm: 190, lengthCm: null });
  });

  it('asks for a plate, then a readable one', () => {
    expect(issues(SavedVehicleInputSchema.safeParse({}))).toEqual(['plate:plateRequired']);
    expect(issues(SavedVehicleInputSchema.safeParse({ plate: ' ' }))).toEqual([
      'plate:plateRequired',
    ]);
    expect(issues(SavedVehicleInputSchema.safeParse({ plate: 'Δ-1' }))).toEqual([
      'plate:plateInvalid',
    ]);
  });

  it('says which size is out of its limits, as the owner’s form does', () => {
    const result = SavedVehicleInputSchema.safeParse({
      plate: 'IKB1234',
      heightCm: 99,
      lengthCm: 1501,
      widthCm: 400.5,
    });
    expect(issues(result)).toEqual([
      'heightCm:sizeHeightInvalid',
      'lengthCm:sizeLengthInvalid',
      'widthCm:sizeWidthInvalid',
    ]);
  });

  it('refuses a name that is too long or has a control character', () => {
    expect(
      issues(SavedVehicleInputSchema.safeParse({ plate: 'IKB1234', name: 'x'.repeat(41) })),
    ).toEqual(['name:textTooLong']);
    expect(
      issues(SavedVehicleInputSchema.safeParse({ plate: 'IKB1234', name: 'a\u0000b' })),
    ).toEqual(['name:invalid']);
  });

  it('refuses fields it does not know, and only reports catalog keys', () => {
    expect(SavedVehicleInputSchema.safeParse({ plate: 'IKB1234', userId: 'x' }).success).toBe(
      false,
    );
    const result = SavedVehicleInputSchema.safeParse({ plate: 1, name: 2, heightCm: 'tall' });
    for (const issue of result.error?.issues ?? []) {
      expect(isValidationMessage(issue.message), issue.message).toBe(true);
    }
  });
});

describe('what the vehicle and favourite routes answer with', () => {
  it('bounds both lists', () => {
    const vehicle = {
      id: '0b4c1f3e-6d2a-4a55-8f0e-1c2d3e4f5a6b',
      plate: 'IKB1234',
      name: null,
      heightCm: null,
      lengthCm: null,
      widthCm: null,
    };
    expect(
      SavedVehicleListSchema.safeParse({
        vehicles: Array.from({ length: VEHICLE_LIMITS.perDriver + 1 }, () => vehicle),
      }).success,
    ).toBe(false);
    expect(
      FavouriteListSchema.safeParse({ listings: new Array(FAVOURITES_MAX + 1).fill({}) }).success,
    ).toBe(false);
  });

  it('has no error code twice', () => {
    expect(new Set(VEHICLE_ERROR_CODES).size).toBe(VEHICLE_ERROR_CODES.length);
  });
});
