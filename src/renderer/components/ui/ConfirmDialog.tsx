/**
 * UX Sweep T2 — shared destructive-action confirm dialog.
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

import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '../../utils/cn';

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
  readonly body: React.ReactNode;
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
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.tabIndex !== -1
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  testId,
}: ConfirmDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

  const titleId = useId();
  const bodyId = useId();

  // Initial focus on the SAFE action; restore the trigger's focus on
  // unmount. Mirrors ModalShell's focus mechanics but seeds Cancel
  // rather than the first focusable, so a reflexive Enter cancels.
  useEffect(() => {
    const previouslyFocused = previouslyFocusedRef.current;
    const requestFrame =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(performance.now()), 0);
    const cancelFrame =
      typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : window.clearTimeout.bind(window);

    const frame = requestFrame(() => {
      const target =
        cancelButtonRef.current ??
        (containerRef.current
          ? getFocusableElements(containerRef.current)[0]
          : null) ??
        containerRef.current;
      target?.focus({ preventScroll: true });
    });

    return () => {
      cancelFrame(frame);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        try {
          previouslyFocused.focus({ preventScroll: true });
        } catch {
          // Best-effort — detached nodes during strict-mode double-mount
          // reject focus(); ignore silently.
        }
      }
    };
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }

    if (event.key !== 'Tab') return;

    const root = containerRef.current;
    if (!root) return;
    const focusable = getFocusableElements(root);
    if (focusable.length === 0) {
      event.preventDefault();
      root.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!root.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus({ preventScroll: true });
      return;
    }

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last?.focus({ preventScroll: true });
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus({ preventScroll: true });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay/70 p-4 backdrop-blur-xl"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={cn(
          'w-full max-w-md overflow-hidden rounded-lg border border-border-subtle bg-bg-panel shadow-lg',
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
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="button-secondary"
            data-testid={testId ? `${testId}-cancel` : undefined}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="button-danger"
            data-testid={testId ? `${testId}-confirm` : undefined}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
