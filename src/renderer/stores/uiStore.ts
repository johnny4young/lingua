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

interface UIState {
  sidebarVisible: boolean;
  consoleVisible: boolean;
  activeBottomPanel: BottomPanelTab;
  statusNotice: StatusNotice | null;
  toggleSidebar: () => void;
  toggleConsole: () => void;
  openBottomPanel: (tab: BottomPanelTab) => void;
  setActiveBottomPanel: (tab: BottomPanelTab) => void;
  setSidebarVisible: (v: boolean) => void;
  setConsoleVisible: (v: boolean) => void;
  pushStatusNotice: (notice: Omit<StatusNotice, 'id'>) => void;
  dismissStatusNotice: () => void;
}

let statusNoticeCounter = 0;

export const useUIStore = create<UIState>((set) => ({
  sidebarVisible: false,
  consoleVisible: false,
  activeBottomPanel: 'console',
  statusNotice: null,
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
}));
