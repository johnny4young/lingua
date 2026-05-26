import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpRequestEditor } from '../../../src/renderer/components/HttpWorkspace/HttpRequestEditor';
import { createBlankHttpRequest } from '../../../src/shared/httpWorkspace';

describe('HttpRequestEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-saves the full draft when edits happen across fields before debounce settles', () => {
    const request = createBlankHttpRequest({
      id: 'r1',
      now: '2026-05-25T00:00:00.000Z',
    });
    const onPatch = vi.fn();

    render(
      <HttpRequestEditor
        request={request}
        onPatch={onPatch}
        onSend={vi.fn()}
        isExecuting={false}
      />
    );

    fireEvent.change(screen.getByTestId('http-request-editor-url'), {
      target: { value: 'https://api.example.com/users' },
    });
    fireEvent.click(screen.getByTestId('http-request-editor-headers-add'));

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: [{ name: '', value: '', enabled: true }],
        body: { kind: 'none' },
      })
    );
  });
});
