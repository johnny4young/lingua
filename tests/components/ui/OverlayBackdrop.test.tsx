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
});
