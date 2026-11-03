import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { rendererFor } from '@/test/render';
import { SaveStatus, useAutosave } from './save-status';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

describe('useAutosave', () => {
  it('saves a value once, however many times the field is left', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useAutosave(save));

    act(() => result.current.autosave('phone', '210'));
    await waitFor(() => expect(result.current.state).toBe('saved'));
    act(() => result.current.autosave('phone', '210'));
    await act(() => result.current.settled());

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('phone', '210');
  });

  it('skips a value that was already on the server', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useAutosave(save));
    act(() => result.current.remember('phone', '210'));
    act(() => result.current.autosave('phone', '210'));
    await act(() => result.current.settled());
    expect(save).not.toHaveBeenCalled();
  });

  it('saves in order, so a slow save can’t overwrite a newer one', async () => {
    const order: string[] = [];
    let finishFirst: (ok: boolean) => void = () => undefined;
    const save = vi.fn((_name: string, value: unknown) => {
      order.push(`start ${String(value)}`);
      return value === 'first'
        ? new Promise<boolean>((resolve) => {
            finishFirst = resolve;
          })
        : Promise.resolve(true);
    });
    const { result } = renderHook(() => useAutosave(save));

    act(() => result.current.autosave('phone', 'first'));
    act(() => result.current.autosave('phone', 'second'));
    await waitFor(() => expect(order).toEqual(['start first']));
    await act(async () => {
      finishFirst(true);
      await result.current.settled();
    });
    expect(order).toEqual(['start first', 'start second']);
  });

  it('reports a failure, and tries the same value again next time', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result } = renderHook(() => useAutosave(save));

    act(() => result.current.autosave('phone', '210'));
    await waitFor(() => expect(result.current.state).toBe('failed'));
    act(() => result.current.autosave('phone', '210'));
    await waitFor(() => expect(result.current.state).toBe('saved'));
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('SaveStatus', () => {
  it('keeps its live region on the page before there is anything to say', () => {
    renderInSubtree(<SaveStatus state="idle" />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says what happened, in the reader’s language', () => {
    renderInSubtree(<SaveStatus state="saved" />, { locale: 'el' });
    expect(screen.getByRole('status')).toHaveTextContent('Αποθηκεύτηκε');
  });

  it('shows “saving” without speaking it, or every field left would say two things', () => {
    renderInSubtree(<SaveStatus state="saving" />);
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says so when a save failed', () => {
    renderInSubtree(<SaveStatus state="failed" />);
    expect(screen.getByRole('status')).toHaveTextContent('That didn’t save.');
  });
});
