/**
 * Signal-Slate recipe: ModalShell.
 *
 * The canonical overlay shell the seven existing overlays
 * (CommandPalette, QuickOpen, Snippets, DeveloperUtilities, etc.) will
 * adopt. It owns the four invariant zones the proposal
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
import { Kbd } from './chrome';
import { getFocusableElements, restoreFocus, trapTab } from './focusTrap';

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
  /** `false` drops the footer bar for overlays that carry their own action row. */
  footer?: boolean;
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
  /** Caps the scrolling body; long forms can ask for more of a tall window. */
  bodyMaxHeightClassName?: string;
  /**
   * `veil` keeps the app readable behind a 55 % veil and rises the sheet 8 px,
   * for launcher-style overlays such as the command palette.
   */
  scrim?: 'blur' | 'veil';
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
       * keycap), so existing callers and the dev showcase render
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
    <div className="flex flex-wrap items-center gap-[14px]">
      <span className="flex items-center gap-[6px] text-caption text-fg-subtle">
        <Kbd>↑↓</Kbd>
        {t('modal.legend.navigate')}
      </span>
      <span className="flex items-center gap-[6px] text-caption text-fg-subtle">
        <Kbd>↵</Kbd>
        {t('modal.legend.select')}
      </span>
      <span className="flex items-center gap-[6px] text-caption text-fg-subtle">
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
  footer = true,
  children,
  size = 'max-w-[620px]',
  labelledById,
  headerClose = 'esc',
  closeLabel,
  bodyClassName,
  bodyMaxHeightClassName = 'max-h-[min(60vh,420px)]',
  scrim = 'blur',
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
      const focusable = getFocusableElements(root);
      // The scroll region participates in keyboard tab order for axe's
      // scrollable-region contract, but it is infrastructure rather than
      // the caller's primary action. Preserve the existing initial-focus
      // behavior by preferring the first interactive descendant.
      const initialTarget =
        focusable.find((element) => !element.hasAttribute('data-modal-scroll-region')) ??
        focusable[0] ??
        root;
      initialTarget.focus({ preventScroll: true });
    });

    const container = containerRef.current;
    return () => {
      cancelFrame(frame);
      restoreFocus(previouslyFocused, container);
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (containerRef.current) trapTab(event, containerRef.current);
  };

  return (
    <div
      // Scrim. -webkit-app-region:no-drag keeps Electron's titlebar drag
      // from swallowing clicks over the modal (see index.css landmine).
      data-scrim={scrim}
      className={cn(
        'fixed inset-0 z-50 flex items-start justify-center pt-[10vh] pb-4',
        scrim === 'veil' ? 'bg-overlay/55' : 'scrim'
      )}
      // Ends above a docked notice, like .overlay-backdrop; the dialog shrinks its body to fit.
      style={{ WebkitAppRegion: 'no-drag', bottom: 'var(--notice-row-offset, 0px)' } as React.CSSProperties}
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
          'mx-4 flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-border-subtle bg-bg-panel shadow-e3',
          scrim === 'veil' ? 'modal-rise' : 'animate-shell-fade',
          'outline-none',
          size
        )}
      >
        {/* HEADER */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-[18px] py-4">
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

        {/* BODY — focusable region: results lists (palette, quick open)
            overflow this container, and a scrollable area whose rows are
            aria-activedescendant options (tabindex -1) is otherwise
            unreachable by keyboard scrolling (axe
            scrollable-region-focusable). */}
        <div
          data-modal-scroll-region
          role="region"
          aria-labelledby={labelledById}
          tabIndex={0}
          className={cn(
            // Shared focus-ring utility + inset so the ring hugs the inside
            // of the scroll region instead of being clipped by the shell's
            // rounded overflow-hidden container.
            'focus-ring min-h-0 overflow-y-auto focus-visible:ring-inset',
            bodyMaxHeightClassName,
            bodyClassName ?? 'px-3 py-[10px]'
          )}
        >
          {children}
        </div>

        {/* FOOTER */}
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border-subtle bg-bg-inset px-[18px] py-[11px]">
            {footerLegend ?? <DefaultFooterLegend />}
            {trailing ? <span className="ml-auto shrink-0">{trailing}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
