/**
 * accessibility pass — shared destructive-action confirm dialog.
 *
 * Extracted from the hand-rolled `role="alertdialog"` overlay that lived
 * inside `ProjectReplace` so every destructive call site (file/folder
 * delete, keymap-preset wipe, shortcut/theme import overwrite, pipeline
 * delete, remove-license, replace-in-files) shares one accessible,
 * focus-trapped, Esc-cancellable confirm surface.
 *
 * Accessibility contract:
 *
 *  - `role="alertdialog"` + `aria-modal="true"`, labelled by the title
 *    (`aria-labelledby`) and described by the body (`aria-describedby`).
 *  - A focus trap keeps Tab inside the dialog; focus is RESTORED to the
 *    element that was focused before the dialog opened on unmount.
 *  - **Initial focus lands on the SAFE (Cancel) action** so a stray
 *    Enter — the muscle-memory key after a destructive click — never
 *    confirms the destruction.
 *  - Escape and a scrim click both CANCEL (the non-destructive path).
 *  - The confirm button carries danger styling so the irreversible
 *    choice never reads as the default/primary affordance.
 *
 * Every visible string arrives translated via props; the component ships
 * no English literals.
 */

import { useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { OverlayBackdrop } from './chrome';

/**
 * Props for {@link ConfirmDialog}. All copy is pre-translated by the
 * caller (the component renders strings verbatim).
 */
export interface ConfirmDialogProps {
  /** Translated dialog title; wired to `aria-labelledby`. */
  readonly title: string;
  /**
   * Translated body copy describing the consequence of confirming;
   * wired to `aria-describedby`. A `ReactNode` is accepted so callers
   * can interpolate emphasis, but it must contain no untranslated
   * literals.
   */
  readonly body: ReactNode;
  /** Translated label for the danger-styled confirm button. */
  readonly confirmLabel: string;
  /** Translated label for the safe cancel button (receives initial focus). */
  readonly cancelLabel: string;
  /** Invoked when the user confirms the destructive action. */
  readonly onConfirm: () => void;
  /** Invoked on Cancel, Escape, or scrim click. */
  readonly onCancel: () => void;
  /**
   * Optional `data-testid` applied to the dialog surface. The confirm /
   * cancel buttons derive their own testids from it (`-confirm` /
   * `-cancel`) when provided.
   */
  readonly testId?: string;
  /** A non-destructive alternative shown between Cancel and confirm (`-alternative` testid). */
  readonly alternative?: { readonly label: string; readonly onSelect: () => void };
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  testId,
  alternative,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  return (
    <OverlayBackdrop className="scrim z-[70]" onClose={onCancel} onKeyDown={handleKeyDown}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={cn(
          'w-full max-w-md overflow-hidden rounded-lg border border-border-subtle bg-bg-panel shadow-e3',
          'animate-shell-fade outline-none'
        )}
        data-testid={testId}
      >
        <header
          id={titleId}
          className="px-5 pt-4 pb-2 text-body-lg font-semibold tracking-[-0.01em] text-fg-base"
        >
          {title}
        </header>
        <div id={bodyId} className="px-5 pb-4 text-body-sm leading-6 text-fg-muted">
          {body}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border-subtle bg-bg-inset px-5 py-3">
          <button
            // The backdrop traps Tab and restores focus; starting on the SAFE action makes a reflexive Enter cancel.
            autoFocus
            type="button"
            onClick={onCancel}
            className="button-secondary"
            data-testid={testId ? `${testId}-cancel` : undefined}
          >
            {cancelLabel}
          </button>
          {alternative ? (
            <button
              type="button"
              onClick={alternative.onSelect}
              className="button-secondary"
              data-testid={testId ? `${testId}-alternative` : undefined}
            >
              {alternative.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onConfirm}
            className="button-danger-solid"
            data-testid={testId ? `${testId}-confirm` : undefined}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </OverlayBackdrop>
  );
}
