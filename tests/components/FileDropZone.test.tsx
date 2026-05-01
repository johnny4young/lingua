import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileDropZone } from '../../src/renderer/components/ui/FileDropZone';
import { initI18n } from '../../src/renderer/i18n';

describe('FileDropZone', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('routes picked files through the same async state machine as drops', async () => {
    let resolveRead!: () => void;
    const onFile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRead = resolve;
        })
    );
    render(
      <FileDropZone
        testId="dropzone"
        inputTestId="dropzone-input"
        hint="Drop a file"
        onFile={onFile}
      />
    );

    const file = new File(['ok'], 'ok.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('dropzone-input'), {
      target: { files: [file] },
    });

    expect(onFile).toHaveBeenCalledWith(file);
    expect(screen.getByTestId('dropzone').getAttribute('data-drop-state')).toBe('dropping');
    resolveRead();

    await waitFor(() => {
      expect(screen.getByTestId('dropzone').getAttribute('data-drop-state')).toBe('idle');
    });
  });

  it('uses localized fallback copy when a picked file is rejected by accept', () => {
    const onFile = vi.fn();
    render(
      <FileDropZone
        testId="dropzone"
        inputTestId="dropzone-input"
        hint="Drop a file"
        accept={() => false}
        onFile={onFile}
      />
    );

    fireEvent.change(screen.getByTestId('dropzone-input'), {
      target: { files: [new File(['no'], 'no.txt', { type: 'text/plain' })] },
    });

    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByTestId('dropzone').getAttribute('data-drop-state')).toBe('error');
    expect(screen.getByText('That file was rejected')).toBeTruthy();
  });
});
