import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('keeps the HTTP workspace tab visible after first open', () => {
    useUIStore.setState({
      activeBottomPanel: 'console',
      consoleVisible: true,
      httpWorkspaceTabVisible: false,
    });
    useUIStore.getState().openBottomPanel('http');
    expect(useUIStore.getState()).toMatchObject({
      activeBottomPanel: 'http',
      consoleVisible: true,
      httpWorkspaceTabVisible: true,
    });
    useUIStore.getState().setActiveBottomPanel('console');
    expect(useUIStore.getState().httpWorkspaceTabVisible).toBe(true);
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

  it('persists floating action-pill position and resets to null', () => {
    const startRevision = useUIStore.getState().floatingPositionsResetRevision;
    useUIStore.setState({ actionPillPosition: null, variablesCardPosition: null });
    useUIStore.getState().setActionPillPosition({ x: 120, y: 64 });
    expect(useUIStore.getState().actionPillPosition).toEqual({ x: 120, y: 64 });
    useUIStore.getState().setVariablesCardPosition({ x: 800, y: 80 });
    expect(useUIStore.getState().variablesCardPosition).toEqual({ x: 800, y: 80 });
    useUIStore.getState().resetFloatingPositions();
    expect(useUIStore.getState().actionPillPosition).toBeNull();
    expect(useUIStore.getState().variablesCardPosition).toBeNull();
    expect(useUIStore.getState().floatingPositionsResetRevision).toBe(startRevision + 1);
  });

  it('toggles the variables-card collapsed flag', () => {
    useUIStore.setState({ variablesCardCollapsed: false });
    useUIStore.getState().toggleVariablesCardCollapsed();
    expect(useUIStore.getState().variablesCardCollapsed).toBe(true);
    useUIStore.getState().setVariablesCardCollapsed(false);
    expect(useUIStore.getState().variablesCardCollapsed).toBe(false);
  });

  it('pushes status notices with incrementing ids and clears on dismiss', () => {
    useUIStore.setState({ statusNotice: null });

    useUIStore.getState().pushStatusNotice({
      tone: 'error',
      messageKey: 'editor.formatOnSave.parseError',
      values: { name: 'demo.js' },
    });
    const first = useUIStore.getState().statusNotice;
    expect(first?.tone).toBe('error');
    expect(first?.id).toBeGreaterThan(0);

    useUIStore.getState().pushStatusNotice({
      tone: 'info',
      messageKey: 'editor.formatOnSave.webUnavailable',
    });
    const second = useUIStore.getState().statusNotice;
    expect(second?.tone).toBe('info');
    expect(second?.id).toBeGreaterThan(first!.id);

    useUIStore.getState().dismissStatusNotice();
    expect(useUIStore.getState().statusNotice).toBeNull();
  });

  it('keeps a high-priority notice visible when a normal notice arrives', () => {
    const incomingDismiss = vi.fn();
    const highSurvived = vi.fn();
    useUIStore.setState({ statusNotice: null });

    useUIStore.getState().pushStatusNotice({
      tone: 'success',
      messageKey: 'onboarding.firstRun.message',
      priority: 'high',
      onSurvived: highSurvived,
    });
    const highNotice = useUIStore.getState().statusNotice;

    useUIStore.getState().pushStatusNotice({
      tone: 'info',
      messageKey: 'editor.formatOnSave.webUnavailable',
      onDismiss: incomingDismiss,
    });

    expect(useUIStore.getState().statusNotice).toBe(highNotice);
    expect(incomingDismiss).toHaveBeenCalledOnce();
    expect(incomingDismiss).toHaveBeenCalledWith('auto');
    expect(highSurvived).toHaveBeenCalledOnce();
  });

  it('lets an error notice override a high-priority notice', () => {
    const highDismiss = vi.fn();
    useUIStore.setState({ statusNotice: null });

    useUIStore.getState().pushStatusNotice({
      tone: 'success',
      messageKey: 'onboarding.firstRun.message',
      priority: 'high',
      onDismiss: highDismiss,
    });
    const highNotice = useUIStore.getState().statusNotice;

    useUIStore.getState().pushStatusNotice({
      tone: 'error',
      messageKey: 'editor.formatOnSave.parseError',
      values: { name: 'demo.js' },
    });

    const errorNotice = useUIStore.getState().statusNotice;
    expect(errorNotice).not.toBe(highNotice);
    expect(errorNotice?.tone).toBe('error');
    expect(errorNotice?.messageKey).toBe('editor.formatOnSave.parseError');
    expect(highDismiss).toHaveBeenCalledOnce();
    expect(highDismiss).toHaveBeenCalledWith('auto');
  });
});
