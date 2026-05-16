import { create } from 'zustand';

export type StatusNoticeTone = 'info' | 'success' | 'warning' | 'error';
export type BottomPanelTab =
  | 'console'
  | 'debugger'
  | 'browser-preview'
  | 'stdin';

export interface StatusNotice {
  id: number;
  tone: StatusNoticeTone;
  messageKey: string;
  /** Optional interpolation values for {{...}} placeholders in the message. */
  values?: Record<string, string | number>;
  /** Optional longer detail appended after the translated message. */
  detail?: string;
}

export interface UIPosition {
  x: number;
  y: number;
}

const ACTION_PILL_POSITION_KEY = 'lingua-ui:action-pill-pos:v2';
const VARIABLES_CARD_POSITION_KEY = 'lingua-ui:variables-card-pos:v2';
const VARIABLES_CARD_COLLAPSED_KEY = 'lingua-ui:variables-card-collapsed';

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
  /** Bumped whenever mounted floating surfaces should return to defaults. */
  floatingPositionsResetRevision: number;
  toggleSidebar: () => void;
  toggleConsole: () => void;
  openBottomPanel: (tab: BottomPanelTab) => void;
  setActiveBottomPanel: (tab: BottomPanelTab) => void;
  setSidebarVisible: (v: boolean) => void;
  setConsoleVisible: (v: boolean) => void;
  pushStatusNotice: (notice: Omit<StatusNotice, 'id'>) => void;
  dismissStatusNotice: () => void;
  setActionPillPosition: (pos: UIPosition | null) => void;
  setVariablesCardPosition: (pos: UIPosition | null) => void;
  setVariablesCardCollapsed: (collapsed: boolean) => void;
  toggleVariablesCardCollapsed: () => void;
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
    statusNoticeCounter += 1;
    set({ statusNotice: { ...notice, id: statusNoticeCounter } });
  },
  dismissStatusNotice: () => set({ statusNotice: null }),
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
