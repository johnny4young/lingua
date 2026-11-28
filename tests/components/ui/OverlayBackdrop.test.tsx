import { createPortal } from 'react-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OverlayBackdrop } from '../../../src/renderer/components/ui/chrome';

function Harness({ open, onClose }: { open: boolean; onClose?: () => void }) {
  return (
    <>
      <button type="button">Trigger</button>
      <textarea aria-label="Editor" />
      {open ? (
        <OverlayBackdrop onClose={onClose}>
          <button type="button">First</button>
          <button type="button">Last</button>
        </OverlayBackdrop>
      ) : null}
    </>
  );
}

describe('OverlayBackdrop', () => {
  it('moves focus in, returns it to the trigger, and leaves it where the dialog sent it', async () => {
    const { rerender } = render(<Harness open={false} />);
    screen.getByRole('button', { name: 'Trigger' }).focus();
    rerender(<Harness open />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' })));
    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Trigger' }));

    rerender(<Harness open />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' })));
    const editor = screen.getByRole('textbox', { name: 'Editor' });
    editor.focus();
    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(editor);
  });

  it('returns focus to the trigger after a loading shell hands over to the real dialog', async () => {
    function Swap({ stage }: { stage: 'closed' | 'loading' | 'ready' }) {
      return (
        <>
          <button type="button">Trigger</button>
          {stage === 'loading' ? (
            <OverlayBackdrop key="loading">
              <button type="button">Cancel loading</button>
            </OverlayBackdrop>
          ) : null}
          {stage === 'ready' ? (
            <OverlayBackdrop key="ready">
              <button type="button">Real</button>
            </OverlayBackdrop>
          ) : null}
        </>
      );
    }
    const { rerender } = render(<Swap stage="closed" />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();
    rerender(<Swap stage="loading" />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel loading' })));
    rerender(<Swap stage="ready" />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Real' })));
    rerender(<Swap stage="closed" />);
    expect(document.activeElement).toBe(trigger);
  });

  it('pulls a forward Tab from outside back to the first control, and closes on a scrim click', async () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    const first = screen.getByRole('button', { name: 'First' });
    await waitFor(() => expect(document.activeElement).toBe(first));
    screen.getByRole('button', { name: 'Trigger' }).focus();
    const backdrop = first.parentElement!;
    expect(backdrop.className).toContain('overlay-backdrop');
    fireEvent.keyDown(backdrop, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('leaves Tab to a dialog portaled above it', async () => {
    render(
      <OverlayBackdrop>
        <button type="button">Behind</button>
        {createPortal(
          <div role="dialog">
            <button type="button">Top first</button>
            <button type="button">Top middle</button>
            <button type="button">Top last</button>
          </div>,
          document.body
        )}
      </OverlayBackdrop>
    );
    const middle = screen.getByRole('button', { name: 'Top middle' });
    middle.focus();
    fireEvent.keyDown(middle, { key: 'Tab' });
    expect(document.activeElement).toBe(middle);
  });
});
