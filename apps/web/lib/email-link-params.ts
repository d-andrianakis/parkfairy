/** Query values as Next passes them: a repeated key arrives as an array. */
type Param = string | string[] | undefined;

/** The token a page opened from an email can use; a bad link has none. */
export function usableToken({ token, error }: { token?: Param; error?: Param }): string | null {
  return typeof token === 'string' && token && error === undefined ? token : null;
}
