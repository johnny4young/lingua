import { create } from 'zustand';

interface UIState {
  sidebarVisible: boolean;
  consoleVisible: boolean;
  toggleSidebar: () => void;
  toggleConsole: () => void;
  setSidebarVisible: (v: boolean) => void;
  setConsoleVisible: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarVisible: false,
  consoleVisible: false,
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleConsole: () => set((s) => ({ consoleVisible: !s.consoleVisible })),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  setConsoleVisible: (consoleVisible) => set({ consoleVisible }),
}));
