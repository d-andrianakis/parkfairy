/** A full page load, in one place so tests can replace it: jsdom can't navigate. */
export function loadPage(url: string): void {
  window.location.assign(url);
}
