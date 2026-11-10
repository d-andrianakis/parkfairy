import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keepClosuresDraft, takeClosuresDraft, type ClosureDraftRow } from './closures-draft';

const LISTING = 'f0f0f0f0-0000-4000-8000-000000000001';
const ROW: ClosureDraftRow = {
  label: 'Πάσχα',
  startsOn: '2027-05-02',
  endsOn: '2027-05-03',
  kind: 'part',
  opens: '08:00',
  closes: '14:00',
  closedFrom: '10:00',
  closedTo: '12:00',
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('the closures draft', () => {
  it('gives the entries back once, for that listing only, without the form’s own keys', () => {
    keepClosuresDraft(LISTING, [{ ...ROW, key: 4 } as ClosureDraftRow]);
    expect(takeClosuresDraft('another-listing')).toBeNull();
    expect(takeClosuresDraft(LISTING)).toEqual([ROW]);
    expect(takeClosuresDraft(LISTING)).toBeNull();
  });

  it('forgets one from an earlier visit', () => {
    keepClosuresDraft(LISTING, [ROW], 1_000);
    expect(takeClosuresDraft(LISTING, 1_000 + 61 * 60_000)).toBeNull();
  });

  it('refuses what isn’t a draft of its own', () => {
    sessionStorage.setItem(
      `parkfairy.closures-draft:${LISTING}`,
      '{"savedAt":1,"rows":[{"kind":"x"}]}',
    );
    expect(takeClosuresDraft(LISTING, 2)).toBeNull();
    sessionStorage.setItem(`parkfairy.closures-draft:${LISTING}`, 'not json');
    expect(takeClosuresDraft(LISTING)).toBeNull();
  });

  it('carries on without storage', () => {
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => keepClosuresDraft(LISTING, [ROW])).not.toThrow();
    blocked.mockRestore();
    expect(takeClosuresDraft(LISTING)).toBeNull();
  });
});
