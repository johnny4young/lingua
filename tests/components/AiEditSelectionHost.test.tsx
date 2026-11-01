import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AiEditSelectionHost } from '@/components/AI/AiEditSelectionHost';
import { useAiEditSelectionStore } from '@/stores/aiEditSelectionStore';

const mounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/hooks/useStatusNotice', () => ({ useStatusNotice: () => ({ error: vi.fn() }) }));
vi.mock('@/components/AI/EditWithAiDialog', () => ({
  EditWithAiDialog: ({ request }: { request: { start: number; end: number } }) => {
    useEffect(() => {
      mounts.count += 1;
    }, []);
    return (
      <div data-testid="edit-dialog-probe">
        {request.start}-{request.end}
      </div>
    );
  },
}));

const base = { code: 'abcdef', start: 1, end: 3, language: 'javascript', modelUri: 'inmemory://a', versionId: 1 };

describe('AiEditSelectionHost', () => {
  it('starts a fresh dialog for a different span of the same file version', async () => {
    render(<AiEditSelectionHost />);
    act(() => useAiEditSelectionStore.getState().open(base));
    await waitFor(() => expect(screen.getByTestId('edit-dialog-probe').textContent).toBe('1-3'));
    expect(mounts.count).toBe(1);

    act(() => useAiEditSelectionStore.getState().open({ ...base, end: 5 }));
    await waitFor(() => expect(screen.getByTestId('edit-dialog-probe').textContent).toBe('1-5'));
    expect(mounts.count).toBe(2);

    act(() => useAiEditSelectionStore.getState().close());
    expect(screen.queryByTestId('edit-dialog-probe')).toBeNull();
  });
});
