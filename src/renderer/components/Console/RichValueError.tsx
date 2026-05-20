/**
 * RL-044 Slice 2a — Sub-slice F clickable error stacks.
 *
 * Renders `kind: 'error'` payloads with a structured stack. Each
 * `ClickableStackFrame` with a `file` + `line` becomes a focusable
 * `<button>` that emits a `lingua-open-source` `CustomEvent` the rest
 * of the app can wire to (RL-024 multi-file lane). Frames without a
 * `file` render as a non-clickable `<span>`.
 *
 * Fold F — frame context menu (right-click): "Copy file:line",
 * "Open in tab", "Copy frame text". The menu is rendered inline below
 * the row when active; Escape / outside-click closes it.
 *
 * Telemetry: every accepted click fires
 * `runtime.error_stack_frame_clicked { language }`. The `language`
 * comes from the stored console entry when available, falling back to
 * a safe `unknown` bucket.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScopeValueError } from '../../../shared/scopeSnapshot';
import type { ClickableStackFrame } from '../../../shared/errorStack';
import { isClickable } from '../../../shared/errorStack';
import { trackEvent } from '../../utils/telemetry';
import { isSafeToken } from '../../../shared/telemetry';

interface RichValueErrorProps {
  payload: ScopeValueError;
  /** Optional language id (`javascript` / `typescript` / `python` / …). */
  language?: string;
  fallbackText?: string;
}

interface FrameMenuState {
  index: number;
  x: number;
  y: number;
}

/**
 * Custom event the rest of the renderer listens for. Wired up
 * incrementally: today an empty document handler logs a notice
 * (RL-024 Slice 1 will wire the actual "open file at line" flow).
 */
function dispatchOpenSource(frame: ClickableStackFrame): void {
  if (typeof window === 'undefined') return;
  const detail = {
    file: frame.file,
    line: frame.line,
    column: frame.column,
    fnName: frame.fnName,
  };
  window.dispatchEvent(new CustomEvent('lingua-open-source', { detail }));
}

export function RichValueError({ payload, language, fallbackText }: RichValueErrorProps) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<FrameMenuState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuItemsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const frames = payload.stack ?? [];
  const langForTelemetry =
    typeof language === 'string' && isSafeToken(language) ? language : 'unknown';

  const handleFrameClick = useCallback(
    (frame: ClickableStackFrame) => {
      if (!isClickable(frame)) return;
      dispatchOpenSource(frame);
      void trackEvent('runtime.error_stack_frame_clicked', {
        language: langForTelemetry,
      });
    },
    [langForTelemetry]
  );

  const handleContextMenu = useCallback((event: React.MouseEvent, index: number) => {
    event.preventDefault();
    setMenu({ index, x: event.clientX, y: event.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  // Close on outside click / Escape / scroll / resize. Scroll + resize
  // close ensures the menu never floats over the wrong row (the fixed-
  // position `top/left` are captured at click time and don't follow the
  // underlying layout).
  useEffect(() => {
    if (menu === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
        return;
      }
      // Arrow-key navigation across menu items (a11y).
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = menuItemsRef.current.filter((el): el is HTMLButtonElement => el !== null);
        if (items.length === 0) return;
        const active = document.activeElement;
        const currentIndex = items.findIndex(el => el === active);
        const nextIndex =
          event.key === 'ArrowDown'
            ? (currentIndex + 1 + items.length) % items.length
            : (currentIndex - 1 + items.length) % items.length;
        items[nextIndex]?.focus();
      }
    };
    const onDoc = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node) {
        if (menuRef.current?.contains(target)) return;
        if (containerRef.current?.contains(target)) return;
      }
      closeMenu();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', closeMenu, true); // capture: closes for any nested scroller too
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [menu, closeMenu]);

  // Clamp the menu into the viewport once mounted so it never paints
  // off the right / bottom edges. Measured after layout to use the
  // actual rendered size.
  useLayoutEffect(() => {
    if (menu === null) return;
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const margin = 8;
    const maxX = window.innerWidth - rect.width - margin;
    const maxY = window.innerHeight - rect.height - margin;
    const clampedX = Math.min(Math.max(margin, menu.x + 4), Math.max(margin, maxX));
    const clampedY = Math.min(Math.max(margin, menu.y + 4), Math.max(margin, maxY));
    if (clampedX !== menu.x + 4 || clampedY !== menu.y + 4) {
      node.style.left = `${clampedX}px`;
      node.style.top = `${clampedY}px`;
    }
    // Focus the first enabled menu item so keyboard nav can start.
    const firstEnabled = menuItemsRef.current.find(
      (el): el is HTMLButtonElement => el !== null && !el.disabled
    );
    firstEnabled?.focus();
  }, [menu]);

  const copyToClipboard = useCallback(async (text: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard failures are non-fatal; the menu closes regardless.
    }
  }, []);

  if (frames.length === 0) {
    // No structured stack → fall back to legacy text path. The chip is
    // never rendered for stackless errors (`payloadHasRichSurface`
    // returns false), but the dispatcher might still arrive here on
    // its catch-all branch.
    return (
      <span
        className="whitespace-pre-wrap text-fg-danger"
        data-testid="console-rich-error-text"
      >
        {fallbackText ?? payload.message}
      </span>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-0.5 font-mono text-[11px]"
      data-testid="console-rich-error"
    >
      <span className="text-fg-danger">{payload.message}</span>
      <span className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
        {t('console.rich.errorStackHeader')}
      </span>
      <ul className="flex flex-col gap-0.5 pl-2">
        {frames.map((frame, index) => {
          const clickable = isClickable(frame);
          const label =
            clickable && frame.file
              ? t('console.rich.errorFrameClickable', {
                  file: frame.file,
                  line: frame.line,
                })
              : t('console.rich.errorFrameUnclickable');
          if (clickable) {
            return (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => handleFrameClick(frame)}
                  onContextMenu={(event) => handleContextMenu(event, index)}
                  data-testid="console-rich-error-frame-clickable"
                  className="rounded-sm px-1 text-left text-fg-info underline-offset-2 hover:bg-bg-elevated hover:underline focus:bg-bg-elevated focus:outline focus:outline-1 focus:outline-fg-info"
                  title={label}
                  aria-label={label}
                >
                  {frame.text}
                </button>
              </li>
            );
          }
          return (
            <li key={index}>
              <span
                onContextMenu={(event) => handleContextMenu(event, index)}
                className="block px-1 text-fg-subtle"
                data-testid="console-rich-error-frame-text"
                title={label}
              >
                {frame.text}
              </span>
            </li>
          );
        })}
      </ul>
      {menu !== null && frames[menu.index] !== undefined && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('console.rich.errorStackHeader')}
          style={{ position: 'fixed', top: menu.y + 4, left: menu.x + 4, zIndex: 50 }}
          className="rounded-md border border-border/60 bg-bg-elevated p-1 text-[11px] shadow-md"
          data-testid="console-rich-error-frame-menu"
        >
          <button
            ref={el => {
              menuItemsRef.current[0] = el;
            }}
            type="button"
            role="menuitem"
            className="block w-full px-2 py-1 text-left hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              const frame = frames[menu.index];
              if (frame?.file && typeof frame.line === 'number') {
                void copyToClipboard(`${frame.file}:${frame.line}`);
              }
              closeMenu();
            }}
            disabled={!isClickable(frames[menu.index]!)}
          >
            {t('console.rich.errorFrameMenuCopyLocation')}
          </button>
          <button
            ref={el => {
              menuItemsRef.current[1] = el;
            }}
            type="button"
            role="menuitem"
            className="block w-full px-2 py-1 text-left hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              const frame = frames[menu.index];
              if (frame && isClickable(frame)) {
                handleFrameClick(frame);
              }
              closeMenu();
            }}
            disabled={!isClickable(frames[menu.index]!)}
          >
            {t('console.rich.errorFrameMenuOpen')}
          </button>
          <button
            ref={el => {
              menuItemsRef.current[2] = el;
            }}
            type="button"
            role="menuitem"
            className="block w-full px-2 py-1 text-left hover:bg-bg"
            onClick={() => {
              const frame = frames[menu.index];
              if (frame) {
                void copyToClipboard(frame.text);
              }
              closeMenu();
            }}
          >
            {t('console.rich.errorFrameMenuCopyText')}
          </button>
        </div>
      )}
    </div>
  );
}
