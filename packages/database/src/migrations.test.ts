import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BLOCKING_STATUSES } from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';

import { migrationsFolder } from './migrations.js';

/**
 * The statuses in the WHERE of the statement that last mentions `name`, sorted; null when there is
 * none. Reads `WHERE ("status" in (…))` (0015, 0017) and `… and "bookings"."status" in (…)` (the
 * continues index). It compares the status list only, not the range or the other columns.
 */
export function statusesOf(sql: string, name: string): string[] | null {
  const from = sql.lastIndexOf(`"${name}"`);
  if (from < 0) return null;
  const rest = sql.slice(from).split('--> statement-breakpoint')[0]!;
  const where = rest.indexOf('WHERE');
  if (where < 0) return null;
  const match = /"status"\s+in\s*\(([^)]*)\)/i.exec(rest.slice(where));
  if (!match) return null;
  return [...match[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
}

interface Journal {
  entries: { idx: number; tag: string }[];
}

describe('migration journal', () => {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;

  it('has one SQL file per journal entry, in order', () => {
    const sqlFiles = readdirSync(migrationsFolder).filter((file) => file.endsWith('.sql'));
    expect(sqlFiles.sort()).toEqual(journal.entries.map((entry) => `${entry.tag}.sql`));
    journal.entries.forEach((entry, index) => expect(entry.idx).toBe(index));
  });

  it('enables PostGIS and btree_gist before anything depends on them', () => {
    const first = journal.entries[0];
    expect(first).toBeDefined();
    const sql = readFileSync(join(migrationsFolder, `${first!.tag}.sql`), 'utf8');
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS postgis');
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist');
  });

  // `BLOCKING_STATUSES` (contracts) says which statuses take a space; the exclusion constraint and the
  // index that serve "is it free?" must say the same, or a new status would double-book silently.
  it('keeps the exclusion constraint and the indexes about live bookings on BLOCKING_STATUSES', () => {
    const latest = (name: string): string => {
      const files = journal.entries
        .map((entry) => readFileSync(join(migrationsFolder, `${entry.tag}.sql`), 'utf8'))
        .filter((sql) => sql.includes(`"${name}"`));
      expect(files.length, name).toBeGreaterThan(0);
      return files[files.length - 1]!;
    };
    const expected = [...BLOCKING_STATUSES].sort();
    expect(statusesOf(latest('bookings_space_no_overlap'), 'bookings_space_no_overlap')).toEqual(
      expected,
    );
    expect(
      statusesOf(latest('bookings_taken_by_listing_idx'), 'bookings_taken_by_listing_idx'),
    ).toEqual(expected);
    expect(statusesOf(latest('bookings_continues_idx'), 'bookings_continues_idx')).toEqual(
      expected,
    );
  });

  it('keeps a snapshot for every migration', () => {
    for (const entry of journal.entries) {
      const snapshot = join(
        migrationsFolder,
        'meta',
        `${String(entry.idx).padStart(4, '0')}_snapshot.json`,
      );
      expect(existsSync(snapshot), snapshot).toBe(true);
    }
  });
});

describe('statusesOf (the guard above)', () => {
  const expected = [...BLOCKING_STATUSES].sort();

  it('reads the forms the migrations use', () => {
    const constraint = `ALTER TABLE "bookings" ADD CONSTRAINT "x_no_overlap"
      EXCLUDE USING gist ("space_id" WITH =) WHERE ("status" in ('held', 'confirmed'));`;
    const generated = `CREATE INDEX "x_idx" ON "bookings" USING btree ("a") WHERE "bookings"."status" in ('held', 'confirmed');--> statement-breakpoint`;
    const compound = `CREATE UNIQUE INDEX "x_uq" ON "bookings" ("a") WHERE "bookings"."a" is not null and "bookings"."status" in ('held', 'confirmed');`;
    expect(statusesOf(constraint, 'x_no_overlap')).toEqual(expected);
    expect(statusesOf(generated, 'x_idx')).toEqual(expected);
    expect(statusesOf(compound, 'x_uq')).toEqual(expected);
  });

  it('shows drift: a status added to a predicate but not to BLOCKING_STATUSES differs', () => {
    const drifted = `ALTER TABLE "bookings" ADD CONSTRAINT "x_no_overlap"
      EXCLUDE USING gist ("space_id" WITH =) WHERE ("status" in ('held', 'confirmed', 'requested'));`;
    expect(statusesOf(drifted, 'x_no_overlap')).toEqual(['confirmed', 'held', 'requested']);
    expect(statusesOf(drifted, 'x_no_overlap')).not.toEqual(expected);
  });

  it('answers null for an unknown name or one without a status predicate', () => {
    expect(statusesOf('CREATE INDEX "a" ON "t" ("b");', 'a')).toBeNull();
    expect(statusesOf('CREATE INDEX "a" ON "t" ("b");', 'missing')).toBeNull();
  });

  it('reads only the last statement that mentions the name', () => {
    const sql = `ALTER TABLE "bookings" ADD CONSTRAINT "x" EXCLUDE USING gist ("a" WITH =) WHERE ("status" in ('held'));--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "x";--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "x" EXCLUDE USING gist ("a" WITH =) WHERE ("status" in ('held', 'confirmed'));`;
    expect(statusesOf(sql, 'x')).toEqual(expected);
  });
});
