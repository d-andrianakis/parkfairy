import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './migrations.js';

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
