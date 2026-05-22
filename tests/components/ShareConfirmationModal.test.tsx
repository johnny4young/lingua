import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShareConfirmationModal } from '../../src/renderer/components/Share/ShareConfirmationModal';

describe('ShareConfirmationModal', () => {
  it('previews both source and stdin before the link can be copied', () => {
    render(
      <ShareConfirmationModal
        previewContent="console.log(process.env.SECRET)"
        stdinPreview="token pasted into stdin"
        language="javascript"
        sizeBytes={512}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByTestId('share-confirm-preview').textContent).toContain(
      'process.env.SECRET'
    );
    expect(
      screen.getByTestId('share-confirm-stdin-preview').textContent
    ).toContain('token pasted into stdin');
  });

  it('omits the stdin preview block when stdin is not part of the payload', () => {
    render(
      <ShareConfirmationModal
        previewContent="print('hello')"
        language="python"
        sizeBytes={320}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByTestId('share-confirm-preview')).toBeTruthy();
    expect(screen.queryByTestId('share-confirm-stdin-preview')).toBeNull();
  });

  it('cancels when Escape is pressed inside the dialog', () => {
    const onCancel = vi.fn();
    render(
      <ShareConfirmationModal
        previewContent="print('hello')"
        language="python"
        sizeBytes={320}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.keyDown(screen.getByTestId('share-confirm-modal'), {
      key: 'Escape',
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
