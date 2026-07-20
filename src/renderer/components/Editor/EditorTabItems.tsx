import { BookOpen, ChevronDown, Database, Globe, Loader2, Wrench, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { languageBadgeTone, languageShortLabel } from '../../utils/languageMeta';
import { cn } from '../../utils/cn';
import { Kbd, Tooltip } from '../ui/chrome';
import type { FileTab, TabExecutionState } from '../../types';
import { GitStatusPill } from './GitStatusPill';
import type { EditorTabSummary } from './editorTabModel';

interface EditorTabItemProps {
  tab: EditorTabSummary;
  index: number;
  isActive: boolean;
  isRenaming: boolean;
  t: TFn;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>, tabId: string) => void;
  onActivate: (tabId: string) => void;
  onActivationKeyDown: (event: KeyboardEvent<HTMLDivElement>, tabId: string) => void;
  onStartRename: (tabId: string) => void;
  onCommitRename: (tabId: string, next: string) => void;
  onCancelRename: () => void;
  onClose: (event: ReactMouseEvent<HTMLButtonElement>, tabId: string) => void;
}

/**
 * P3 — a single tab in the strip, memoized for visible metadata changes.
 * Content-only changes never reach this boundary; the parent subscription
 * projects them away before render.
 */
export const EditorTabItem = memo(function EditorTabItem({
  tab,
  index,
  isActive,
  isRenaming,
  t,
  onContextMenu,
  onActivate,
  onActivationKeyDown,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onClose,
}: EditorTabItemProps) {
  // MOV.02 (FASE 3) — workspace + notebook tabs carry a neutral
  // marker language ('sql' / 'http') whose shortLabel resolves to
  // "TXT", which would mislead a screen-reader user. Prefix the
  // accessible label with the kind code instead so the tab announces
  // "SQL …" / "HTTP …" / "NB …" to match the glyph.
  const tabLabel = `${tabKindShortCode(tab) ?? languageShortLabel(tab.language)} ${tab.name}`;

  return (
    <Tooltip content={resolveTabTooltip(tab, t)} disabled={isRenaming}>
      <div
        data-tab-id={tab.id}
        data-active={isActive}
        data-execution-state={tab.executionState ?? 'idle'}
        onContextMenu={event => onContextMenu(event, tab.id)}
        className={cn(
          'group relative flex h-full min-w-[11rem] shrink-0 items-center gap-2 border-r border-border/60 px-3 text-body-sm transition-colors',
          isActive
            ? // Active: panel bg + 2px top accent + matching bottom border so the
              // tab visually merges with the editor surface below.
              '-mb-px bg-background-elevated text-foreground border-t-2 border-t-primary'
            : 'cursor-pointer border-t-2 border-t-transparent bg-surface-strong/72 text-muted hover:bg-surface-strong hover:text-foreground'
        )}
      >
        <div
          role="button"
          tabIndex={isActive ? 0 : -1}
          aria-current={isActive ? 'page' : undefined}
          aria-label={tabLabel}
          data-testid="editor-tab-activation"
          onClick={() => !isRenaming && onActivate(tab.id)}
          onKeyDown={event => onActivationKeyDown(event, tab.id)}
          className="flex h-full min-w-0 flex-1 items-center gap-2"
        >
          {/* MOV.02 (FASE 3) — workspace + notebook tabs lead with
              a kind glyph (Database / Globe / BookOpen) instead of
              the language code chip, which would otherwise read
              "TXT" for the neutral 'sql' / 'http' marker languages.
              Code tabs keep the uppercase DS language chip. The
              mono face on the chip is set inline so the filename
              span remains the only `.font-mono` element legacy
              callers query. */}
          {tab.kind === 'sql' ||
          tab.kind === 'http' ||
          tab.kind === 'notebook' ||
          tab.kind === 'utilities' ? (
            <TabKindGlyph kind={tab.kind} />
          ) : (
            <TabLanguageChip language={tab.language} />
          )}
          {isRenaming ? (
            <RenameInput
              initialName={tab.name}
              placeholder={t('editorTabs.rename.placeholder')}
              ariaLabel={t('editorTabs.rename.ariaLabel', { name: tab.name })}
              onCommit={next => onCommitRename(tab.id, next)}
              onCancel={onCancelRename}
            />
          ) : (
            <span
              data-testid="editor-tab-filename"
              onDoubleClick={() => onStartRename(tab.id)}
              className={cn(
                'min-w-0 flex-1 truncate font-mono text-caption leading-none',
                tab.executionState === 'error' && 'text-error/95'
              )}
            >
              {tab.name}
            </span>
          )}
        </div>

        {/* implementation — Git status pill (clean / modified /
            untracked / unknown) inline between the filename and
            the execution status dot. Self-renders to null when
            git posture is unavailable, settings master is OFF,
            or the magic-comment opt-out is set on this file. */}
        {!isRenaming && tab.filePath ? (
          <GitStatusPill
            filePath={tab.filePath}
            language={tab.language}
            suppressedByMagic={tab.gitStatusSuppressed}
          />
        ) : null}

        {/* Status indicator — single source per tab. Precedence:
            running > error > success > dirty > none.
            Hidden when the close button takes over on hover. */}
        {!isRenaming ? (
          <TabStatusControl
            tab={tab}
            unsavedLabel={t('editorTabs.unsaved', { name: tab.name })}
            closeLabel={t('editorTabs.close', { name: tab.name })}
            onClose={event => onClose(event, tab.id)}
          />
        ) : null}
        <span aria-hidden className="hidden" data-index={index} />
      </div>
    </Tooltip>
  );
});

/**
 * The inline rename input. Local-state-only so the parent does not
 * see every keystroke. Commits the trimmed value on Enter; cancels on
 * Escape (no commit, no toast). On blur we treat it as a soft commit
 * because users frequently click elsewhere expecting their typed
 * name to stick.
 */
function RenameInput({
  initialName,
  placeholder,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  initialName: string;
  placeholder: string;
  ariaLabel: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    // Highlight the basename so a user who only wants to swap the
    // extension can keep typing without selecting first.
    const dot = initialName.lastIndexOf('.');
    if (dot > 0) node.setSelectionRange(0, dot);
    else node.select();
  }, [initialName]);

  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  };

  const commit = () => {
    if (finishedRef.current) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialName) {
      cancel();
      return;
    }
    finishedRef.current = true;
    onCommit(trimmed);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-testid="editor-tab-rename-input"
      onChange={event => setValue(event.target.value)}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
      className="min-w-0 flex-1 rounded-md border border-primary/45 bg-background-elevated px-1.5 py-0.5 font-mono text-caption leading-none text-foreground outline-none focus:ring-2 focus:ring-ring/45"
    />
  );
}

/* ---------------------------------------------------------------- */
/* Tab status indicator                                              */
/* ---------------------------------------------------------------- */

/**
 * internal — single source of truth for the tab's right-edge state
 * indicator. The close button replaces whatever dot is showing on
 * hover so the user always has one click to close, regardless of
 * the tab's current lifecycle state.
 *
 * Precedence (matches Signal-Slate):
 *
 *   running → spinning loader
 *   error   → red dot with halo
 *   success → green dot, fades out after 2s via opacity transition
 *   dirty   → primary dot
 *   idle    → no dot (close button still appears on hover)
 */
function TabStatusControl({
  tab,
  unsavedLabel,
  closeLabel,
  onClose,
}: {
  tab: EditorTabSummary;
  unsavedLabel: string;
  closeLabel: string;
  onClose: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const state: TabExecutionState = tab.executionState ?? 'idle';

  // Pick the accessible label that matches the visible dot. Dirty + no
  // execution state => surface the historical "unsaved changes" copy
  // so screen-reader callers reading the regression test pass.
  const accessibleLabel = state === 'idle' && tab.isDirty ? unsavedLabel : undefined;

  return (
    <span className="relative ml-0.5 inline-flex size-5 shrink-0 items-center justify-center">
      {/* Status marker — hidden on hover so close button can take over. */}
      {state === 'running' ? (
        <Loader2
          size={11}
          className="pointer-events-none absolute animate-spin text-primary transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0"
          aria-hidden="true"
          data-testid="editor-tab-running-spinner"
        />
      ) : (
        <span
          {...(accessibleLabel
            ? { role: 'img', 'aria-label': accessibleLabel }
            : { 'aria-hidden': 'true' as const })}
          className={cn(
            'pointer-events-none absolute inline-block rounded-full transition-opacity duration-150',
            'group-hover:opacity-0 group-focus-visible:opacity-0',
            stateDotClasses(state, tab.isDirty)
          )}
        />
      )}
      {/* Close button — appears on hover/focus. Always rendered (size kept
         predictable) but only visible via opacity. */}
      <button
        type="button"
        aria-label={closeLabel}
        data-tab-close="true"
        data-tab-id-close={tab.id}
        onClick={onClose}
        className="inline-flex size-5 items-center justify-center rounded-md text-muted opacity-0 transition-opacity duration-150 hover:bg-surface-strong/82 hover:text-foreground group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100"
      >
        <X size={10} />
      </button>
    </span>
  );
}

/**
 * Map per-tab state to the dot's color + size + halo.
 *
 * Returns an empty string when there's nothing to show — the
 * absolutely-positioned span still renders for layout, but it has
 * no visual.
 */
function stateDotClasses(state: TabExecutionState, isDirty: boolean): string {
  if (state === 'error') {
    // Red dot with subtle ring so it pops against any tab bg.
    return 'h-2 w-2 bg-error ring-2 ring-error/15';
  }
  if (state === 'success') {
    return 'h-1.5 w-1.5 bg-success';
  }
  if (isDirty) {
    return 'h-1.5 w-1.5 bg-primary';
  }
  return 'h-0 w-0';
}

/**
 * Tooltip text — surfaces parseError details when present so the
 * user knows what failed without opening the console. Falls back to
 * the filename otherwise.
 */
type TFn = (key: string, opts?: Record<string, unknown>) => string;

function resolveTabTooltip(tab: EditorTabSummary, t: TFn): string {
  if (tab.executionState === 'error' && tab.parseError) {
    return `${tab.name} · ${tab.parseError}`;
  }
  if (tab.executionState === 'running') {
    return `${tab.name} · ${t('editorTabs.running')}`;
  }
  if (tab.isDirty) {
    return `${tab.name} · ${t('editorTabs.unsavedTitle')}`;
  }
  return tab.name;
}

/**
 * implementation — `+N` overflow popover. Provides a single jump
 * point across every open tab without horizontal-scrolling the tab
 * strip. Renders a chevron button at the right of the strip; opening
 * the popover gives a scrollable tab list with lang chip, filename,
 * dirty dot, and an inline close button.
 *
 * Outside-click / Escape close the popover.
 */
export function TabsOverflowDropdown({
  tabs,
  activeTabId,
  hiddenCount,
  onSelect,
  onClose,
}: {
  tabs: readonly EditorTabSummary[];
  activeTabId: string | null;
  hiddenCount: number;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // accessibility pass — close the popover and return focus to the chevron
  // trigger, so a keyboard user who Escapes (or selects) lands back on
  // the tab strip instead of having focus dumped to the document body.
  const closeToTrigger = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      // Mouse click elsewhere — close, but leave focus where the user
      // clicked rather than yanking it back to the trigger.
      setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeToTrigger();
    };
    window.addEventListener('mousedown', onClickAway);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClickAway);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, closeToTrigger]);

  // accessibility pass — move focus into the menu on open (the active tab's row
  // if present, else the first), so the ↑↓ navigation the footer
  // advertises actually has a starting point.
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const target =
      menu.querySelector<HTMLButtonElement>(
        'button[role="menuitem"][data-active="true"]'
      ) ?? menu.querySelector<HTMLButtonElement>('button[role="menuitem"]');
    target?.focus();
  }, [open]);

  // accessibility pass — implement the ↑↓ / Home / End roving the footer legend
  // promises (it was previously decorative). Mirrors the tab context
  // menu's keyboard pattern.
  const handleMenuKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)'
      )
    );
    if (buttons.length === 0) return;
    event.preventDefault();
    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    const lastIndex = buttons.length - 1;
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? lastIndex
          : event.key === 'ArrowDown'
            ? (currentIndex + 1 + buttons.length) % buttons.length
            : (currentIndex - 1 + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  }, []);

  const dirtyCount = tabs.filter(tab => tab.isDirty).length;

  return (
    <div ref={containerRef} className="relative ml-1 flex items-center">
      <Tooltip
        content={t('editorTabs.overflow.tooltip', {
          count: hiddenCount,
          total: tabs.length,
        })}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('editorTabs.overflow.ariaLabel', { count: hiddenCount })}
          data-testid="editor-tabs-overflow"
          onClick={() => setOpen(prev => !prev)}
          className={cn(
            'inline-flex h-full items-center gap-1.5 border-l border-border/60 px-3 font-mono text-eyebrow font-semibold uppercase tracking-[0.12em] text-fg-muted transition-colors hover:bg-bg-panel-alt/70 hover:text-fg-base',
            open && 'bg-bg-panel-alt text-fg-base'
          )}
        >
          <span>+{hiddenCount}</span>
          <ChevronDown size={11} aria-hidden />
        </button>
      </Tooltip>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label={t('editorTabs.overflow.ariaLabel', { count: hiddenCount })}
          onKeyDown={handleMenuKeyDown}
          className="dropdown-rich absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[340px] max-h-[400px] flex-col overflow-hidden outline-none"
          style={{ display: 'flex' }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {tabs.map((tab, index) => {
              const isActive = tab.id === activeTabId;
              const isHidden = index >= 5;
              return (
                <div
                  key={tab.id}
                  className={cn(
                    'group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
                    isActive ? 'bg-primary-soft' : 'hover:bg-bg-panel-alt/70'
                  )}
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-active={isActive}
                    data-testid={`editor-tabs-overflow-item-${tab.id}`}
                    onClick={() => {
                      onSelect(tab.id);
                      closeToTrigger();
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {tab.kind === 'sql' ||
                    tab.kind === 'http' ||
                    tab.kind === 'notebook' ||
                    tab.kind === 'utilities' ? (
                      <TabKindGlyph kind={tab.kind} size="menu" />
                    ) : (
                      <TabLanguageChip language={tab.language} size="menu" />
                    )}
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate font-mono text-body-sm',
                        isActive ? 'text-accent-fg font-semibold' : 'text-fg-base'
                      )}
                    >
                      {tab.name}
                    </span>
                    {isHidden ? (
                      <span
                        aria-hidden
                        className="rounded-full bg-bg-panel-alt px-1.5 font-mono text-micro font-semibold text-fg-subtle"
                      >
                        +{index - 4}
                      </span>
                    ) : null}
                    {tab.isDirty ? (
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-warning-fg"
                        title={t('editorTabs.unsavedTitle')}
                      />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      onClose(tab.id);
                    }}
                    aria-label={t('editorTabs.close', { name: tab.name })}
                    className="invisible inline-flex size-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-panel hover:text-fg-base group-hover:visible"
                  >
                    <X size={11} aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2 font-mono text-eyebrow text-fg-subtle">
            <Kbd>↑↓</Kbd>
            <span>{t('actionPill.navigate')}</span>
            <span className="flex-1" />
            <span>
              {t('editorTabs.overflow.footer', {
                total: tabs.length,
                dirty: dirtyCount,
              })}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * MOV.02 (FASE 3) — short type code for workspace + notebook tabs,
 * used in the accessible tab label so it doesn't fall back to the
 * neutral marker language's "TXT". Returns null for code tabs (they
 * keep their language short label). Matches the prototype TypeGlyph
 * codes (SQL / HTTP / UTIL / NB).
 */
function tabKindShortCode(tab: EditorTabSummary): string | null {
  if (tab.kind === 'sql') return 'SQL';
  if (tab.kind === 'http') return 'HTTP';
  if (tab.kind === 'notebook') return 'NB';
  if (tab.kind === 'utilities') return 'UTIL';
  return null;
}

/**
 * MOV.02 (FASE 3) — per-kind type glyph rendered before the language
 * chip. Workspace + notebook tabs carry a `kind` discriminator
 * (`'sql' | 'http' | 'notebook'`); code tabs do not. The glyph gives
 * those special tabs an at-a-glance identity (Database / Globe /
 * BookOpen) matching the prototype's TypeGlyph, while code tabs keep
 * the language code chip alone. Returns null for code tabs so the
 * existing chip-only layout is untouched.
 */
function TabKindGlyph({ kind, size = 'tab' }: { kind: FileTab['kind']; size?: 'tab' | 'menu' }) {
  if (kind !== 'sql' && kind !== 'http' && kind !== 'notebook' && kind !== 'utilities') {
    return null;
  }
  const Icon =
    kind === 'sql' ? Database : kind === 'http' ? Globe : kind === 'notebook' ? BookOpen : Wrench;
  const iconSize = size === 'menu' ? 13 : 12;
  // Kind-tinted so SQL / HTTP / Utilities / Notebook read distinctly without
  // leaning on color alone (icon shape carries the identity too).
  // HTTP uses the informational (blue) tone rather than green: the
  // Signal-Slate rule reserves the success hue for the Run action and
  // Success results only, so a green tab-kind marker would dilute it.
  const tone =
    kind === 'sql'
      ? 'text-accent'
      : kind === 'http'
        ? 'text-info-fg'
        : kind === 'notebook'
          ? 'text-primary'
          : 'text-warning-fg';
  return (
    <span
      data-testid="editor-tab-kind-glyph"
      data-tab-kind={kind}
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center', tone)}
    >
      <Icon size={iconSize} />
    </span>
  );
}

function TabLanguageChip({
  language,
  size = 'tab',
}: {
  language: FileTab['language'];
  size?: 'tab' | 'menu';
}) {
  const tone = languageBadgeTone(language);
  return (
    <span
      data-testid="editor-tab-lang-chip"
      className="shrink-0 rounded-sm font-bold leading-none"
      style={{
        minWidth: size === 'menu' ? 24 : 21,
        height: size === 'menu' ? 22 : 17,
        padding: size === 'menu' ? '0 5px' : '0 4px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: size === 'menu' ? 9.5 : 9,
        letterSpacing: '0.04em',
        background: tone.background,
        color: tone.foreground,
      }}
    >
      {tone.code}
    </span>
  );
}
