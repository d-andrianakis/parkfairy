import { FormError } from '@/components/form-error';

/** Takes the focus when it appears, in whatever place the page puts it: it mounts, it focuses. */
function focusOnMount(element: HTMLDivElement | null) {
  element?.focus();
}

/**
 * Why a change was refused as out of date (someone else got there first): kept above what the
 * refreshed page now offers, with the focus, since the form it came from is gone. A new attempt
 * clears it first, so the same refusal again appears again and is announced again.
 */
export function StaleNotice({ message }: { message: string }) {
  return (
    <div
      ref={focusOnMount}
      tabIndex={-1}
      className="mb-4 rounded-sm outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <FormError message={message} />
    </div>
  );
}
