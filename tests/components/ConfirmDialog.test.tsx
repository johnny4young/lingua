import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '../../src/renderer/components/ui/ConfirmDialog';

describe('ConfirmDialog', () => {
  const baseProps = {
    title: 'Delete this item?',
    body: 'This cannot be undone.',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
  };

  it('renders an alertdialog with an accessible name from the title', () => {
    render(
      <ConfirmDialog {...baseProps} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    // getByRole with `name` exercises the accessible-name computation,
    // which resolves through aria-labelledby → the title element.
    expect(
      screen.getByRole('alertdialog', { name: 'Delete this item?' })
    ).toBeTruthy();
  });

  it('puts initial focus on the SAFE (Cancel) action', async () => {
    render(
      <ConfirmDialog {...baseProps} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });

  it('a stray Enter on initial focus cancels, never confirms', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog {...baseProps} onConfirm={onConfirm} onCancel={onCancel} />
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    // Cancel button is focused; a reflexive Enter activates it.
    await user.keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('invokes onConfirm when the confirm button is clicked', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog {...baseProps} onConfirm={onConfirm} onCancel={onCancel} />
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels on Escape', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog {...baseProps} onConfirm={onConfirm} onCancel={onCancel} />
    );
    // Wait for the focus seed so the Escape keydown originates inside the
    // dialog and bubbles to the scrim's onKeyDown handler.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Cancel' })
      )
    );
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not bubble handled Escape to parent overlay key handlers', async () => {
    const onCancel = vi.fn();
    const parentKeyDown = vi.fn();
    const user = userEvent.setup();
    render(
      <div onKeyDown={parentKeyDown}>
        <ConfirmDialog
          {...baseProps}
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      </div>
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Cancel' })
      )
    );
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('cancels on a scrim click', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        {...baseProps}
        testId="my-confirm"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );
    // The scrim is the dialog's parent (the fixed-inset overlay).
    const dialog = screen.getByTestId('my-confirm');
    const scrim = dialog.parentElement!;
    await user.click(scrim);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('derives confirm/cancel testids from the testId prop', () => {
    render(
      <ConfirmDialog
        {...baseProps}
        testId="my-confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByTestId('my-confirm-confirm')).toBeTruthy();
    expect(screen.getByTestId('my-confirm-cancel')).toBeTruthy();
  });
});
