import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';

// Guards the data conventions in memory.md for every table, including future ones.
const tables = Object.values(schema as Record<string, unknown>).filter((value): value is PgTable =>
  is(value, PgTable),
);
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

it('discovers the schema tables', () => {
  expect(tables.length).toBeGreaterThanOrEqual(5);
});

describe.each(tables.map((table) => [getTableConfig(table).name, table] as const))(
  'table %s',
  (name, table) => {
    const config = getTableConfig(table);

    it('uses snake_case table and column names', () => {
      expect(name).toMatch(SNAKE_CASE);
      for (const column of config.columns) expect(column.name).toMatch(SNAKE_CASE);
    });

    it('has a generated uuid primary key named id', () => {
      const id = config.columns.find((column) => column.name === 'id');
      expect(id?.primary).toBe(true);
      expect(id?.getSQLType()).toBe('uuid');
      expect(id?.hasDefault).toBe(true);
    });

    it('stores every timestamp with a time zone (UTC instants)', () => {
      const timestamps = config.columns.filter((c) => c.getSQLType().startsWith('timestamp'));
      for (const column of timestamps) {
        expect(column.getSQLType(), column.name).toBe('timestamp with time zone');
      }
    });

    it('never stores money as floating point', () => {
      for (const column of config.columns) {
        expect(['real', 'double precision'], column.name).not.toContain(column.getSQLType());
      }
    });
  },
);

describe('users', () => {
  it('constrains role and locale to known values in the database', () => {
    const checks = getTableConfig(schema.users).checks.map((check) => check.name);
    expect(checks).toEqual(expect.arrayContaining(['users_role_check', 'users_locale_check']));
  });
});

describe('parking inventory', () => {
  it('constrains enum-like listing columns and money to known values', () => {
    const checks = getTableConfig(schema.parkingLocations).checks.map((check) => check.name);
    expect(checks).toEqual(
      expect.arrayContaining([
        'parking_locations_status_check',
        'parking_locations_area_check',
        'parking_locations_content_locale_check',
        'parking_locations_currency_check',
        'parking_locations_hourly_rate_check',
      ]),
    );
  });

  it('stores money as integer minor units next to a currency', () => {
    const columns = getTableConfig(schema.parkingLocations).columns;
    const type = (name: string) => columns.find((c) => c.name === name)?.getSQLType();
    expect(type('hourly_rate_minor')).toBe('integer');
    expect(type('daily_max_minor')).toBe('integer');
    expect(type('currency')).toBe('char(3)');
  });

  it('stores locations as geography points', () => {
    const location = getTableConfig(schema.parkingLocations).columns.find(
      (c) => c.name === 'location',
    );
    expect(location?.getSQLType()).toBe('geography(Point,4326)');
  });
});

describe('parseEwkbPoint', () => {
  it('decodes PostGIS EWKB with an SRID (Syntagma Square)', () => {
    // SELECT ST_SetSRID(ST_MakePoint(23.7348, 37.9755), 4326)::geography
    const hex = '0101000020E6100000CE1951DA1BBC3740BE9F1A2FDDFC4240';
    const point = schema.parseEwkbPoint(hex);
    expect(point.longitude).toBeCloseTo(23.7348, 6);
    expect(point.latitude).toBeCloseTo(37.9755, 6);
  });

  it('refuses geometry that is not a point', () => {
    expect(() => schema.parseEwkbPoint('010200000000000000')).toThrow('Not a WKB point');
  });
});

it('maps every Better Auth model to a table', () => {
  expect(Object.keys(schema.authSchema).sort()).toEqual(
    ['account', 'session', 'twoFactor', 'user', 'verification'].sort(),
  );
});
