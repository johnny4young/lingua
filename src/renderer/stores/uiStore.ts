import { create } from 'zustand';

export type StatusNoticeTone = 'info' | 'success' | 'warning' | 'error';
export type BottomPanelTab =
  | 'console'
  | 'debugger'
  | 'browser-preview'
  | 'stdin'
  | 'variables'
  // RL-025 Slice A — bottom-panel sibling for the Dependencies tab.
  // Conditional render in `AppLayout.tsx` keeps the button hidden
  // until the active tab has ≥1 detected dependency, so users who
  // never paste an import never see the chrome.
  | 'dependencies'
  // RL-102 Slice 1 — bottom-panel sibling for the Git diff view.
  // Conditional render in `AppLayout.tsx` gates on
  // `gitLayerAvailable(posture)` so users opening a folder that is
  // not a git repo never see the chrome. Mount fires the
  // `git.diff_panel_opened` telemetry (fold D).
  | 'git-diff'
  // RL-097 Slice 1 — bottom-panel sibling for the HTTP workspace.
  // Always available (no entitlement, no folder requirement). Tab
  // surfaces via Mod+Shift+K (Mod+Shift+J first considered but taken
  // by `view-show-dependencies`) or the `Open HTTP workspace`
  // palette entry. Slice 2 mirrors this surface with the SQL
  // workspace tab below.
  | 'http'
  // RL-097 Slice 2 — bottom-panel sibling for the SQL workspace
  // (DuckDB-WASM). Same "always available" posture as HTTP. Tab
  // surfaces via Mod+Alt+S (Mod+Shift+Q rejected — macOS log-out
  // OS-level conflict) or the `Open SQL workspace` palette entry.
  | 'sql';
export type VariablesViewMode = 'list' | 'cards';

/**
 * RL-101 Slice 1 fold A — optional interactive CTA on a status
 * notice. Lets the first-run / first-snippet onboarding toasts
 * surface a single-click action (Save as snippet / Open snippets)
 * without lifting custom toast components per surface. Designed
 * as an array (fold A) so future variants (Save + Skip, Confirm
 * + Settings) can grow without re-shaping the type.
 *
 * The banner renders the action label via i18n (`t(labelKey)`),
 * dismisses the original notice as `'cta'`, then invokes `onClick`
 * once. That order lets the CTA publish a replacement notice without
 * the banner clearing it afterwards; manual X dismisses report
 * `'manual'` and the timeout reports `'auto'` (fold B).
 */
export interface StatusNoticeAction {
  readonly labelKey: string;
  readonly onClick: () => void;
}

export type StatusNoticeDismissMode = 'cta' | 'manual' | 'auto';

/**
 * RL-101 Slice 1.5 fold B — priority tier for notice replacement.
 *
 * Surfaced during pre-commit review of RL-101 Slice 1: the
 * onboarding first-run toast was being clobbered within ~600 ms by
 * an unrelated boot-time notice push, so fresh-install users never
 * saw the Save-as-snippet CTA. The 134 existing `pushStatusNotice`
 * callers all run at the implicit `'normal'` tier, which preserves
 * the prior "last writer wins" behaviour. Onboarding pushes
 * `'high'`; `pushStatusNotice` refuses to overwrite an outstanding
 * `'high'` notice with a `'normal'` one and instead drops the
 * incoming notice silently (it still emits its own `onDismiss('auto')`
 * for telemetry attribution). Errors and explicit dismiss paths
 * always win regardless of priority.
 *
 * `'low'` is reserved for future ambient surfaces (telemetry
 * heartbeats, idle background hints) so they can never displace
 * either onboarding (`'high'`) or routine product feedback
 * (`'normal'`).
 */
export type StatusNoticePriority = 'low' | 'normal' | 'high';

export interface StatusNotice {
  id: number;
  tone: StatusNoticeTone;
  messageKey: string;
  /** Optional interpolation values for {{...}} placeholders in the message. */
  values?: Record<string, string | number>;
  /** Optional longer detail appended after the translated message. */
  detail?: string;
  /** RL-101 fold A — optional interactive CTAs rendered as buttons. */
  actions?: ReadonlyArray<StatusNoticeAction>;
  /**
   * RL-101 fold B — optional callback invoked exactly once whenever
   * the notice goes away, with the route that closed it. Lets the
   * pusher attribute dismiss telemetry across CTA / manual X / auto
   * timeout without coupling the notice schema to telemetry itself.
   * The dispatcher guarantees at-most-once delivery per notice.
   */
  onDismiss?: (mode: StatusNoticeDismissMode) => void;
  /**
   * RL-101 Slice 1.5 fold B — replacement priority. Default
   * `'normal'` preserves the legacy "last writer wins" behaviour
   * for the 134 existing callers. `'high'` is for onboarding /
   * choreographed toasts that must survive any same-tone push.
   * Incoming errors always bypass the priority check.
   */
  priority?: StatusNoticePriority;
  /**
   * RL-101 Slice 1.5 fold A — optional callback fired when this
   * notice REFUSES a lower-priority replacement attempt. Lets the
   * pusher (e.g. `useOnboardingChoreography`) emit
   * `onboarding.toast_clobbered` telemetry so we can see in
   * production how often the new priority field saves a toast.
   * Fire-and-forget; can fire multiple times per notice if multiple
   * clobber attempts happen during its lifetime.
   */
  onSurvived?: () => void;
}

export interface UIPosition {
  x: number;
  y: number;
}

const ACTION_PILL_POSITION_KEY = 'lingua-ui:action-pill-pos:v4';
const VARIABLES_CARD_POSITION_KEY = 'lingua-ui:variables-card-pos:v2';
const VARIABLES_CARD_COLLAPSED_KEY = 'lingua-ui:variables-card-collapsed';
const VARIABLES_BOTTOM_VIEW_MODE_KEY = 'lingua-ui:variables-bottom-view-mode';

/**
 * Read a `{x,y}` from `localStorage` without throwing if the key is
 * missing or the JSON is malformed. Used to hydrate `actionPillPosition`
 * and `variablesCardPosition` on first render so the layout doesn't
 * jump after the persist middleware kicks in (we never adopted that
 * middleware for uiStore — see RL-071 plan).
 */
function readPersistedPosition(key: string): UIPosition | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'x' in parsed &&
      'y' in parsed &&
      typeof (parsed as { x: unknown }).x === 'number' &&
      typeof (parsed as { y: unknown }).y === 'number'
    ) {
      return { x: (parsed as UIPosition).x, y: (parsed as UIPosition).y };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readPersistedVariablesViewMode(): VariablesViewMode {
  if (typeof window === 'undefined') return 'list';
  try {
    const raw = window.localStorage.getItem(VARIABLES_BOTTOM_VIEW_MODE_KEY);
    if (raw === 'cards') return 'cards';
  } catch {
    /* ignore */
  }
  return 'list';
}

function readPersistedBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

/**
 * Reviewer pass — probe the persisted `lingua-workspace-tool-state`
 * key for any saved requests so the boot-time
 * `httpWorkspaceTabVisible` can default to `true` when the user
 * has saved work. Avoids the friction of having to re-trigger
 * Mod+Shift+K on every reload to find a request you already have.
 * Fully defensive: any localStorage / JSON malformation falls
 * through to `false` so a corrupt store can never crash the boot.
 */
function hasPersistedHttpRequests(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem('lingua-workspace-tool-state');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { state?: { requests?: unknown } };
    const requests = parsed?.state?.requests;
    return Array.isArray(requests) && requests.length > 0;
  } catch {
    return false;
  }
}

/**
 * RL-097 Slice 2 — mirror of `hasPersistedHttpRequests` for the
 * SQL workspace store. Keeps boot ergonomics symmetrical: a user
 * with saved queries sees the SQL tab without having to hit the
 * shortcut every reload.
 */
function hasPersistedSqlQueries(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem('lingua-workspace-sql-state');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { state?: { queries?: unknown } };
    const queries = parsed?.state?.queries;
    return Array.isArray(queries) && queries.length > 0;
  } catch {
    return false;
  }
}

function writePersisted<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  } catch {
    /* ignore quota / mode errors */
  }
}

interface UIState {
  sidebarVisible: boolean;
  consoleVisible: boolean;
  activeBottomPanel: BottomPanelTab;
  /**
   * RL-097 Slice 1 — HTTP tab is hidden on first boot, then remains
   * in the bottom-panel tab strip after the user opens it once via
   * shortcut or palette.
   */
  httpWorkspaceTabVisible: boolean;
  /**
   * RL-097 Slice 2 — SQL tab is hidden on first boot, then remains
   * in the strip after the user opens it once. Mirrors
   * `httpWorkspaceTabVisible`.
   */
  sqlWorkspaceTabVisible: boolean;
  statusNotice: StatusNotice | null;
  /**
   * Custom position for the floating Action Pill, when the user has
   * dragged it away from its default centred-above-editor slot. `null`
   * means "use default position".
   */
  actionPillPosition: UIPosition | null;
  /** Custom position for the floating Variables card. `null` = default. */
  variablesCardPosition: UIPosition | null;
  /** When true the Variables floating card shrinks to a pill chip. */
  variablesCardCollapsed: boolean;
  /**
   * RL-093 Slice 3 fold G — persisted List ↔ Cards mode for the bottom
   * panel Variables tab. Floating card has its own dedicated render so
   * this only applies when `variableInspectorSurface === 'bottom'`.
   */
  variablesBottomViewMode: VariablesViewMode;
  /** Bumped whenever mounted floating surfaces should return to defaults. */
  floatingPositionsResetRevision: number;
  toggleSidebar: () => void;
  toggleConsole: () => void;
  openBottomPanel: (tab: BottomPanelTab) => void;
  setActiveBottomPanel: (tab: BottomPanelTab) => void;
  setSidebarVisible: (v: boolean) => void;
  setConsoleVisible: (v: boolean) => void;
  pushStatusNotice: (notice: Omit<StatusNotice, 'id'>) => void;
  /**
   * RL-101 fold B — `mode` records how the dismiss happened so the
   * pusher's `onDismiss` callback can attribute telemetry. Defaults
   * to `'manual'` because the banner X-button is the most common
   * caller; the auto-dismiss timeout and CTA handlers pass their own
   * mode explicitly. Calling repeatedly is safe — the onDismiss
   * callback fires at most once per notice.
   */
  dismissStatusNotice: (mode?: StatusNoticeDismissMode) => void;
  setActionPillPosition: (pos: UIPosition | null) => void;
  setVariablesCardPosition: (pos: UIPosition | null) => void;
  setVariablesCardCollapsed: (collapsed: boolean) => void;
  toggleVariablesCardCollapsed: () => void;
  setVariablesBottomViewMode: (mode: VariablesViewMode) => void;
  resetFloatingPositions: () => void;
}

let statusNoticeCounter = 0;

/**
 * RL-101 Slice 1.5 fold B — priority comparator helper. `'high'` >
 * `'normal'` > `'low'`. Pure function for testability.
 */
function priorityRank(priority: StatusNoticePriority): number {
  if (priority === 'high') return 2;
  if (priority === 'low') return 0;
  return 1;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarVisible: false,
  consoleVisible: false,
  activeBottomPanel: 'console',
  // Reviewer pass — seed `httpWorkspaceTabVisible` from the
  // persisted workspaceToolStore: if the user has any saved
  // requests on this device, surface the tab so they can find
  // them again without having to remember the Mod+Shift+K
  // shortcut after every reload. localStorage read happens lazily
  // here (the workspaceToolStore is another module which may not
  // have hydrated yet — we read the JSON directly).
  httpWorkspaceTabVisible: hasPersistedHttpRequests(),
  sqlWorkspaceTabVisible: hasPersistedSqlQueries(),
  statusNotice: null,
  actionPillPosition: readPersistedPosition(ACTION_PILL_POSITION_KEY),
  variablesCardPosition: readPersistedPosition(VARIABLES_CARD_POSITION_KEY),
  variablesCardCollapsed: readPersistedBoolean(VARIABLES_CARD_COLLAPSED_KEY, false),
  variablesBottomViewMode: readPersistedVariablesViewMode(),
  floatingPositionsResetRevision: 0,
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleConsole: () =>
    set((s) => ({
      activeBottomPanel: 'console',
      consoleVisible: s.activeBottomPanel === 'console' ? !s.consoleVisible : true,
    })),
  openBottomPanel: (activeBottomPanel) =>
    set({
      activeBottomPanel,
      consoleVisible: true,
      ...(activeBottomPanel === 'http' ? { httpWorkspaceTabVisible: true } : {}),
      ...(activeBottomPanel === 'sql' ? { sqlWorkspaceTabVisible: true } : {}),
    }),
  setActiveBottomPanel: (activeBottomPanel) =>
    set({
      activeBottomPanel,
      ...(activeBottomPanel === 'http' ? { httpWorkspaceTabVisible: true } : {}),
      ...(activeBottomPanel === 'sql' ? { sqlWorkspaceTabVisible: true } : {}),
    }),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  setConsoleVisible: (consoleVisible) => set({ consoleVisible }),
  pushStatusNotice: (notice) => {
    // RL-101 Slice 1.5 fold B — priority-respecting replacement.
    // A `'normal'` (the implicit default for the 134 legacy callers)
    // notice CANNOT overwrite an outstanding `'high'` notice. The
    // incoming notice is dropped and its own `onDismiss('auto')`
    // fires so the pusher's telemetry stays honest. Errors override
    // priority — a real error always reaches the user.
    const previous = useUIStore.getState().statusNotice;
    const incomingPriority: StatusNoticePriority = notice.priority ?? 'normal';
    const outstandingPriority: StatusNoticePriority =
      previous?.priority ?? 'normal';
    const incomingIsError = notice.tone === 'error';
    if (
      previous &&
      !incomingIsError &&
      priorityRank(incomingPriority) < priorityRank(outstandingPriority)
    ) {
      // Outstanding notice has strictly higher priority and the
      // incoming push is not an error — refuse the swap. Fire the
      // incoming notice's onDismiss so the pusher knows it was
      // never visible, AND fire the outstanding notice's optional
      // onSurvived callback so the surviving pusher can attribute
      // telemetry (`onboarding.toast_clobbered` records the survived
      // stage so we can correlate clobber attempts to choreography
      // stage).
      if (notice.onDismiss) {
        try {
          notice.onDismiss('auto');
        } catch {
          // onDismiss is fire-and-forget.
        }
      }
      if (previous.onSurvived) {
        try {
          previous.onSurvived();
        } catch {
          // onSurvived is fire-and-forget.
        }
      }
      return;
    }
    // RL-101 fold B — if a previous notice is still up when a new one
    // arrives (race between toast 1 + toast 2), close the outgoing
    // notice as `'auto'` so the pusher's telemetry doesn't lose the
    // signal. Mirrors the spec edge-case "toast 2 reemplaza toast 1
    // limpiamente, NO stacking de banners".
    if (previous?.onDismiss) {
      try {
        previous.onDismiss('auto');
      } catch {
        // Swallow — the new notice still has to land. The onDismiss
        // contract is fire-and-forget.
      }
    }
    statusNoticeCounter += 1;
    set({ statusNotice: { ...notice, id: statusNoticeCounter } });
  },
  dismissStatusNotice: (mode: StatusNoticeDismissMode = 'manual') => {
    const previous = useUIStore.getState().statusNotice;
    if (!previous) return;
    if (previous.onDismiss) {
      try {
        previous.onDismiss(mode);
      } catch {
        // Swallow — the notice still has to clear.
      }
    }
    set({ statusNotice: null });
  },
  setActionPillPosition: (pos) => {
    writePersisted(ACTION_PILL_POSITION_KEY, pos);
    set({ actionPillPosition: pos });
  },
  setVariablesCardPosition: (pos) => {
    writePersisted(VARIABLES_CARD_POSITION_KEY, pos);
    set({ variablesCardPosition: pos });
  },
  setVariablesCardCollapsed: (collapsed) => {
    writePersisted(VARIABLES_CARD_COLLAPSED_KEY, collapsed ? 'true' : 'false');
    set({ variablesCardCollapsed: collapsed });
  },
  toggleVariablesCardCollapsed: () =>
    set((s) => {
      const next = !s.variablesCardCollapsed;
      writePersisted(VARIABLES_CARD_COLLAPSED_KEY, next ? 'true' : 'false');
      return { variablesCardCollapsed: next };
    }),
  setVariablesBottomViewMode: (mode) => {
    if (mode !== 'list' && mode !== 'cards') return;
    writePersisted(VARIABLES_BOTTOM_VIEW_MODE_KEY, mode);
    set({ variablesBottomViewMode: mode });
  },
  resetFloatingPositions: () => {
    writePersisted<null>(ACTION_PILL_POSITION_KEY, null);
    writePersisted<null>(VARIABLES_CARD_POSITION_KEY, null);
    set((s) => ({
      actionPillPosition: null,
      variablesCardPosition: null,
      floatingPositionsResetRevision: s.floatingPositionsResetRevision + 1,
    }));
  },
}));
