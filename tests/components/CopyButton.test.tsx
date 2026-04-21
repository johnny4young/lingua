import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';

const writeToClipboardMock = vi.hoisted(() =>
  vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true)
);

vi.mock('../../src/renderer/utils/clipboard', () => ({
  writeToClipboard: writeToClipboardMock,
}));

import { CopyButton } from '../../src/renderer/components/DeveloperUtilities/CopyButton';

describe('CopyButton', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    writeToClipboardMock.mockReset().mockResolvedValue(true);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the provided value to the clipboard and toggles to the copied state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CopyButton value="hello-world" />);

    const button = screen.getByTestId('copy-button');
    expect(button.getAttribute('data-copied')).toBeNull();

    await user.click(button);

    expect(writeToClipboardMock).toHaveBeenCalledWith('hello-world');
    await waitFor(() => expect(button.getAttribute('data-copied')).toBe('true'));

    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(button.getAttribute('data-copied')).toBeNull();
  });

  it('resolves the value lazily when passed a thunk', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let current = 'first';
    render(<CopyButton value={() => current} />);

    current = 'second';
    await user.click(screen.getByTestId('copy-button'));

    expect(writeToClipboardMock).toHaveBeenCalledWith('second');
  });

  it('is inert when the disabled prop is set even with a value', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CopyButton value="present" disabled />);

    const button = screen.getByTestId('copy-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(button);
    expect(writeToClipboardMock).not.toHaveBeenCalled();
  });

  it('does not flip into the copied state when the clipboard write fails', async () => {
    writeToClipboardMock.mockResolvedValueOnce(false);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CopyButton value="x" />);

    const button = screen.getByTestId('copy-button');
    await user.click(button);
    await act(async () => {
      await Promise.resolve();
    });
    expect(button.getAttribute('data-copied')).toBeNull();
  });
});
