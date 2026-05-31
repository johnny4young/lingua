/**
 * FASE 0 — Signal-Slate recipe: ModalShell.
 *
 * The canonical overlay shell the seven existing overlays
 * (CommandPalette, QuickOpen, Snippets, DeveloperUtilities, etc.) will
 * adopt in FASE 1. It owns the four invariant zones the proposal
 * standardizes on: a blurred scrim, a header row (icon + caller content
 * + an Esc hint), a scrollable body, and a footer kbd legend rail with
 * an optional trailing slot (e.g. a result count).
 *
 * Translated from `redesign-after.jsx` (`ModalShellAfter`) — the inline
 * `oklch` scrim/panel/border palette there is mapped onto DS tokens
 * (`bg-overlay/70`, `bg-bg-panel`, `border-border-subtle`, `bg-bg-inset`)
 * so the shell resolves in both themes. The kbd legend wording (↑↓
 * navigate · ↵ select · esc close) and footer layout come from that
 * mockup; the focus-trap / Escape / scrim-close behavior matches the
 * existing `OverlayBackdrop` in `chrome.tsx`.
 *
 * PRIMITIVE: every visible string arrives via props/children. The only
 * literal glyphs are the keycap symbols (↑↓ ↵ esc), which are not
 * translatable UI copy.
 */

import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

/* ------------------------------------------------------------------ Kbd */

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

/**
 * Internal keycap used by the shell's footer rail and Esc hint. Kept
 * local to the shell so callers get a matching keycap without importing
 * the legacy `.kbd-shell` class (which carries the old rounded-lg
 * styling). Mono / 10.5px / alt-panel surface per the proposal.
 */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border border-border-subtle bg-bg-panel-alt px-1.5 py-0.5',
        'font-mono text-[10.5px] font-medium leading-none text-fg-muted',
        className
      )}
    >
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------ focus trap */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.tabIndex !== -1
  );
}

/* ------------------------------------------------------------ ModalShell */

/**
 * How the header's close affordance renders:
 *
 *  - `esc`    — the trailing Esc keycap (current/default behavior, used by
 *               the SEARCH-header overlays: palette, quickopen).
 *  - `button` — a small lucide `X` icon button wired to `onClose`, used by
 *               the TITLE-header overlays (snippets, utilities, recipes,
 *               capsules, import) per the MOV.01 prototype. Renders
 *               INSTEAD of the Esc keycap.
 *  - `none`   — neither affordance (caller owns its own close UI).
 *
 * Escape and scrim-click always close regardless of this value.
 */
export type ModalShellHeaderClose = 'esc' | 'button' | 'none';

interface ModalShellBaseProps {
  /** Called on Escape, scrim click, and the Esc keycap / x button (caller wires it). */
  onClose: () => void;
  /** Optional leading glyph rendered in a muted slot in the header. */
  icon?: ReactNode;
  /** Header content — typically a search input or a placeholder row. */
  header: ReactNode;
  /** Footer-left legend. Defaults to the standard kbd navigation rail. */
  footerLegend?: ReactNode;
  /** Footer-right slot — e.g. a result count. */
  trailing?: ReactNode;
  /** The scrollable body region. */
  children: ReactNode;
  /** Width clamp class for the container. Defaults to `max-w-[620px]`. */
  size?: string;
  /** id of the element labelling the dialog (wired to aria-labelledby). */
  labelledById?: string;
  /**
   * Overrides the default body padding (`px-3 py-[10px]`). Master-detail
   * overlays (snippets, utilities) pass their own grid padding here so the
   * shell does not double-pad the two-column layout.
   */
  bodyClassName?: string;
}

/**
 * The header close affordance is a discriminated union on `headerClose`
 * so the `x`-button variant CANNOT be constructed without a translated
 * `closeLabel`. This makes a forgotten label a compile error rather than
 * a silent English `aria-label` leaking into an ES session (the AST copy
 * guard can't see a default-param literal). `esc` / `none` (and the
 * default) keep `closeLabel` irrelevant.
 */
type ModalShellCloseProps =
  | {
      /**
       * `button` renders the lucide `x` close button used by the
       * TITLE-header overlays (snippets, utilities, recipes, capsules,
       * import). Requires `closeLabel`.
       */
      headerClose: 'button';
      /** Translated aria-label for the `x` close button. Required. */
      closeLabel: string;
    }
  | {
      /**
       * Header close affordance. Defaults to `esc` (the trailing Esc
       * keycap), so existing callers and the FASE 0 showcase render
       * unchanged. `none` lets the caller own its close UI.
       */
      headerClose?: 'esc' | 'none';
      /** Unused for `esc`/`none`; accepted so spreads stay ergonomic. */
      closeLabel?: undefined;
    };

export type ModalShellProps = ModalShellBaseProps & ModalShellCloseProps;

/**
 * The default footer rail: ↑↓ navigate · ↵ select · esc close. Rendered
 * when the caller does not pass `footerLegend`. The arrow glyphs are
 * U+2191/2193 (up/down) and U+21B5 (return), per the proposal spec; the
 * words resolve through the shared `modal.legend.*` keys so the shell
 * ships no English legend literals. The dedicated `<ModalFooterLegend>`
 * recipe (used by callers that need a different pair set, e.g. an
 * `open` rail) reuses the same keys.
 */
function DefaultFooterLegend() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-[14px]">
      <span className="flex items-center gap-[6px] text-[11.5px] text-fg-subtle">
        <Kbd>↑↓</Kbd>
        {t('modal.legend.navigate')}
      </span>
      <span className="flex items-center gap-[6px] text-[11.5px] text-fg-subtle">
        <Kbd>↵</Kbd>
        {t('modal.legend.select')}
      </span>
      <span className="flex items-center gap-[6px] text-[11.5px] text-fg-subtle">
        <Kbd>esc</Kbd>
        {t('modal.legend.close')}
      </span>
    </div>
  );
}

export function ModalShell({
  onClose,
  icon,
  header,
  footerLegend,
  trailing,
  children,
  size = 'max-w-[620px]',
  labelledById,
  headerClose = 'esc',
  closeLabel,
  bodyClassName,
}: ModalShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

  // Move focus into the container on mount; restore it to the
  // previously-focused element on unmount. Mirrors OverlayBackdrop so
  // the new shell behaves identically to the overlays it will replace.
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
      const root = containerRef.current;
      if (!root || root.contains(document.activeElement)) return;
      (getFocusableElements(root)[0] ?? root).focus({ preventScroll: true });
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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
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

    if (event.shiftKey && (active === first || !root.contains(active))) {
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
      // Scrim. -webkit-app-region:no-drag keeps Electron's titlebar drag
      // from swallowing clicks over the modal (see index.css landmine).
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay/70 pt-[10vh] backdrop-blur-xl"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        tabIndex={-1}
        className={cn(
          'mx-4 w-full overflow-hidden rounded-lg border border-border-subtle bg-bg-panel shadow-lg',
          'animate-shell-fade outline-none',
          size
        )}
      >
        {/* HEADER */}
        <div className="flex items-center gap-3 border-b border-border-subtle px-[18px] py-4">
          {icon ? (
            <span className="grid shrink-0 place-items-center text-fg-subtle">{icon}</span>
          ) : null}
          <div className="min-w-0 flex-1">{header}</div>
          {headerClose === 'esc' ? <Kbd>esc</Kbd> : null}
          {headerClose === 'button' ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle',
                'hover:bg-bg-inset hover:text-fg-base',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70'
              )}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {/* BODY */}
        <div
          className={cn(
            'max-h-[min(60vh,420px)] overflow-y-auto',
            bodyClassName ?? 'px-3 py-[10px]'
          )}
        >
          {children}
        </div>

        {/* FOOTER */}
        <div className="flex items-center justify-between border-t border-border-subtle bg-bg-inset px-[18px] py-[11px]">
          {footerLegend ?? <DefaultFooterLegend />}
          {trailing ? <span className="shrink-0">{trailing}</span> : null}
        </div>
      </div>
    </div>
  );
}
