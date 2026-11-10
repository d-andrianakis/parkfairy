const PREFIX = 'parkfairy.closures-draft:';
/** A draft older than this is from another visit, and the stored entries may have moved on. */
const MAX_AGE_MS = 60 * 60_000;
const KINDS = ['closed', 'open', 'part'];
const TEXT_FIELDS = [
  'label',
  'startsOn',
  'endsOn',
  'opens',
  'closes',
  'closedFrom',
  'closedTo',
] as const;

/** One entry of the closures form as the owner left it, before saving. */
export interface ClosureDraftRow {
  label: string;
  startsOn: string;
  endsOn: string;
  kind: 'closed' | 'open' | 'part';
  opens: string;
  closes: string;
  closedFrom: string;
  closedTo: string;
}

function isRow(value: unknown): value is ClosureDraftRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    KINDS.includes(row.kind as string) &&
    TEXT_FIELDS.every(
      (name) => typeof row[name] === 'string' && (row[name] as string).length <= 500,
    )
  );
}

/**
 * Keeps the closures form's unsaved entries while the owner goes to cancel the bookings in the way
 * (decision #27), so they come back to what they typed (3.1). This tab only, and once: taking it
 * removes it. Storage can be blocked; then only the typing is lost, as before.
 */
export function keepClosuresDraft(listingId: string, rows: ClosureDraftRow[], now = Date.now()) {
  try {
    // The fields only: the form's rows carry its own keys besides.
    const kept = rows.map((row) =>
      Object.fromEntries((['kind', ...TEXT_FIELDS] as const).map((name) => [name, row[name]])),
    );
    sessionStorage.setItem(PREFIX + listingId, JSON.stringify({ savedAt: now, rows: kept }));
  } catch {}
}

/** The draft kept for this listing, if a recent one is there; it is forgotten either way. */
export function takeClosuresDraft(listingId: string, now = Date.now()): ClosureDraftRow[] | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + listingId);
    sessionStorage.removeItem(PREFIX + listingId);
    if (!raw) return null;
    const draft = JSON.parse(raw) as { savedAt?: unknown; rows?: unknown };
    if (typeof draft.savedAt !== 'number' || now - draft.savedAt > MAX_AGE_MS) return null;
    if (!Array.isArray(draft.rows) || !draft.rows.every(isRow)) return null;
    return draft.rows;
  } catch {
    return null;
  }
}
