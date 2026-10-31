/** Query values as Next passes them: a repeated key arrives as an array. */
type Param = string | string[] | undefined;

/** Marks a page showing "check your inbox" after its form was sent (see `useSentPanel`). */
export const SENT_PARAM = 'sent';

/** The token a page opened from an email can use; a bad link has none. */
export function usableToken({ token, error }: { token?: Param; error?: Param }): string | null {
  return typeof token === 'string' && token && error === undefined ? token : null;
}

/** The query of a page that can show that panel. */
export interface SentPanelSearch {
  searchParams: Promise<{ [SENT_PARAM]?: Param }>;
}

export function showsSentPanel(search: Awaited<SentPanelSearch['searchParams']>): boolean {
  return search[SENT_PARAM] !== undefined;
}
