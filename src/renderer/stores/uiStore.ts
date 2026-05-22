import { create } from 'zustand';

export type StatusNoticeTone = 'info' | 'success' | 'warning' | 'error';
export type BottomPanelTab =
  | 'console'
  | 'debugger'
  | 'browser-preview'
  | 'stdin'
  | 'variables';
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

export const useUIStore = create<UIState>((set) => ({
  sidebarVisible: false,
  consoleVisible: false,
  activeBottomPanel: 'console',
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
  openBottomPanel: (activeBottomPanel) => set({ activeBottomPanel, consoleVisible: true }),
  setActiveBottomPanel: (activeBottomPanel) => set({ activeBottomPanel }),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  setConsoleVisible: (consoleVisible) => set({ consoleVisible }),
  pushStatusNotice: (notice) => {
    // RL-101 fold B — if a previous notice is still up when a new one
    // arrives (race between toast 1 + toast 2), close the outgoing
    // notice as `'auto'` so the pusher's telemetry doesn't lose the
    // signal. Mirrors the spec edge-case "toast 2 reemplaza toast 1
    // limpiamente, NO stacking de banners".
    const previous = useUIStore.getState().statusNotice;
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
