import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '@/stores/uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarVisible: true, consoleVisible: true });
  });

  it('should have sidebar and console visible by default', () => {
    const state = useUIStore.getState();
    expect(state.sidebarVisible).toBe(true);
    expect(state.consoleVisible).toBe(true);
  });

  it('should toggle sidebar', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarVisible).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  it('should toggle console', () => {
    useUIStore.getState().toggleConsole();
    expect(useUIStore.getState().consoleVisible).toBe(false);
    useUIStore.getState().toggleConsole();
    expect(useUIStore.getState().consoleVisible).toBe(true);
  });

  it('should set sidebar visibility directly', () => {
    useUIStore.getState().setSidebarVisible(false);
    expect(useUIStore.getState().sidebarVisible).toBe(false);
    useUIStore.getState().setSidebarVisible(true);
    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  it('should set console visibility directly', () => {
    useUIStore.getState().setConsoleVisible(false);
    expect(useUIStore.getState().consoleVisible).toBe(false);
    useUIStore.getState().setConsoleVisible(true);
    expect(useUIStore.getState().consoleVisible).toBe(true);
  });
});
