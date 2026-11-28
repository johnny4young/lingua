/**
 * The command bar's context and verb slots. A surface fills them from where
 * its state lives: `<CommandBarSlot slot="verb">` portals into the bar, so
 * the SQL editor keeps owning its Run and the HTTP editor its Send. Without
 * a bar (an isolated render) the children stay inline; in presenter mode
 * they are dropped.
 */

import { ChevronDown } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import {
  activeCommandBarClaim,
  useCommandBarSlotStore,
  type CommandBarSlotKind,
} from '../../stores/commandBarSlotStore';
import { usePresenterModeStore } from '../../stores/presenterModeStore';
import { useDismissible } from '../../hooks/useDismissible';
import { useMenuKeyboard } from '../../hooks/useMenuKeyboard';
import { useCommandBarSlotScope } from './commandBarSlotScope';
import { SurfaceBadge } from './CommandBarSlotHost';
import type { Language } from '../../types/language';
import { cn } from '../../utils/cn';
import { Kbd } from '../ui/chrome';
import { MonoBadge } from '../ui/primitives';

export function CommandBarSlot({
  slot,
  priority = 0,
  children,
}: {
  slot: CommandBarSlotKind;
  /** A higher priority wins the slot; equal priorities go to the latest claim. */
  priority?: number;
  children: ReactNode;
}) {
  const id = useId();
  const scope = useCommandBarSlotScope();
  const claims = scope === 'bar';
  const claim = useCommandBarSlotStore((state) => state.claim);
  const release = useCommandBarSlotStore((state) => state.release);
  useLayoutEffect(() => {
    if (!claims) return;
    claim(slot, id, priority);
    return () => release(slot, id);
  }, [claim, release, claims, slot, id, priority]);
  const active = useCommandBarSlotStore((state) => activeCommandBarClaim(state.claims[slot]) === id);
  const host = useCommandBarSlotStore((state) => state.hosts[slot]);
  const presenting = usePresenterModeStore((state) => state.active);
  if (scope === 'off') return null;
  if (scope === 'inline') return <>{children}</>;
  if (host) return active ? createPortal(children, host) : null;
  return presenting ? null : <>{children}</>;
}

interface ContextChipProps {
  badge?: Language;
  /** A small mark after the badge, such as an environment dot. */
  leading?: ReactNode;
  name: string;
  detail?: string;
  /** Without a handler the chip is a static label. */
  onClick?: () => void;
  expanded?: boolean;
  popup?: 'menu' | 'listbox';
  controls?: string;
  ariaLabel?: string;
  testId: string;
  ref?: Ref<HTMLButtonElement>;
  data?: Record<`data-${string}`, string>;
}

/** The bar's context: what the verb acts on (runtime, connection, environment, cell). */
export function CommandBarContextChip({
  badge,
  leading,
  name,
  detail,
  onClick,
  expanded,
  popup,
  controls,
  ariaLabel,
  testId,
  ref,
  data,
}: ContextChipProps) {
  const body = (
    <>
      {badge ? <SurfaceBadge language={badge} /> : null}
      {leading}
      <span className="action-pill-context-name max-w-[14rem] truncate">{name}</span>
      {detail ? (
        <span className="action-pill-context-detail max-w-[12rem] truncate font-mono text-caption font-normal text-fg-muted">
          {detail}
        </span>
      ) : null}
    </>
  );
  const className = 'focus-ring action-pill-segment action-pill-lang action-pill-context rounded-l-lg rounded-r-none';
  const badgeAttr = badge ? { 'data-has-badge': 'true' } : {};
  if (!onClick) {
    return (
      <span data-testid={testId} className={className} {...badgeAttr} {...data}>
        {body}
      </span>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      aria-haspopup={popup}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className={className}
      {...badgeAttr}
      {...data}
    >
      {body}
      <ChevronDown size={10} className="shrink-0 text-fg-subtle" aria-hidden />
    </button>
  );
}

export interface CommandBarVerbItem {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  testId?: string;
  onSelect: () => void;
}

interface VerbProps {
  label: string;
  icon: ReactNode;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Pulses while work is in flight (the label is then Stop or Cancel). */
  running?: boolean;
  title?: string;
  ariaLabel?: string;
  describedBy?: string;
  testId: string;
  style?: CSSProperties;
  /** Extra classes on the verb and its chevron. */
  className?: string;
  data?: Record<`data-${string}`, string>;
  /** Keep the split menu while running, for entries that do not start a run. */
  menuWhileRunning?: boolean;
  menu?: {
    label: string;
    testId: string;
    listTestId: string;
    items: readonly CommandBarVerbItem[];
    disabled?: boolean;
  };
}

/** The bar's one filled action, with an optional split menu for its other modes. */
export function CommandBarVerb({
  label,
  icon,
  shortcut,
  onClick,
  disabled = false,
  running = false,
  title,
  ariaLabel,
  describedBy,
  testId,
  style,
  className,
  data,
  menuWhileRunning = false,
  menu,
}: VerbProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const showMenu = Boolean(menu) && (!running || menuWhileRunning);
  // A run that starts while the menu is open closes it for good.
  const [menuShown, setMenuShown] = useState(showMenu);
  if (menuShown !== showMenu) {
    setMenuShown(showMenu);
    if (!showMenu) setOpen(false);
  }
  const menuOpen = open && showMenu;

  useDismissible(menuOpen, rootRef, setOpen, toggleRef);
  useMenuKeyboard(menuOpen, menuRef);

  return (
    <div ref={rootRef} className="action-pill-run-group relative inline-flex items-stretch">
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          onClick();
        }}
        disabled={disabled}
        data-testid={testId}
        data-running={running ? 'true' : 'false'}
        aria-label={ariaLabel ?? label}
        aria-describedby={describedBy}
        title={title}
        style={style}
        className={cn('action-pill-run action-pill-run-main rounded-l-none', !showMenu && 'rounded-r-lg', className)}
        {...data}
      >
        <span aria-hidden className="inline-flex">
          {icon}
        </span>
        <span className="max-w-[220px] truncate">{label}</span>
        {shortcut ? <Kbd className="action-pill-kbd">{shortcut}</Kbd> : null}
      </button>
      {showMenu && menu ? (
        <button
          ref={toggleRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={menu.label}
          data-testid={menu.testId}
          disabled={menu.disabled}
          style={style}
          className={cn('action-pill-run action-pill-run-menu rounded-r-lg', className)}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown size={16} aria-hidden />
        </button>
      ) : null}
      {menuOpen && menu ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={menu.label}
          data-testid={menu.listTestId}
          className="dropdown-rich absolute right-0 top-[calc(100%+0.4rem)] z-50 w-max min-w-[280px] max-w-[min(380px,calc(100vw-2rem))]"
        >
          {menu.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              data-testid={item.testId}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="focus-ring dropdown-rich-row w-full items-center disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
            >
              <span className="row-icon">{item.icon}</span>
              <span className="row-label">{item.label}</span>
              {item.shortcut ? <MonoBadge tone="accent">{item.shortcut}</MonoBadge> : <span />}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
