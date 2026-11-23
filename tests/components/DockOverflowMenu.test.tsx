import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunCapsuleV1 } from '@/../shared/runCapsule';
import { initI18n } from '@/i18n';
import { DockOverflowMenu } from '@/components/Layout/DockOverflowMenu';
import { useResultStore } from '@/stores/resultStore';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

const mocks = vi.hoisted(() => ({
  activeTab: vi.fn(),
  capsule: { current: null as RunCapsuleV1 | null },
  emitCommand: vi.fn(),
  exportCapsuleWithNotice: vi.fn(),
}));

vi.mock('@/stores/editorStore', async importOriginal => ({
  ...(await importOriginal<typeof import('@/stores/editorStore')>()),
  useEditorStore: (selector: (state: unknown) => unknown) => selector({}),
  getActiveTab: () => mocks.activeTab(),
}));

vi.mock('@/stores/commandBus', () => ({ emitCommand: mocks.emitCommand }));
vi.mock('@/stores/executionHistoryStore', () => ({
  useExecutionHistoryStore: (selector: (state: { latestCapsule: () => RunCapsuleV1 | null }) => unknown) =>
    selector({ latestCapsule: () => mocks.capsule.current }),
}));
vi.mock('@/components/Editor/runCapsuleExportLoader', () => ({
  loadCapsuleExporter: () => Promise.resolve({ exportCapsuleWithNotice: mocks.exportCapsuleWithNotice }),
}));

describe('DockOverflowMenu', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    mocks.activeTab.mockReturnValue({ id: 'tab-1', language: 'javascript', workflowMode: 'scratchpad', autoLogEnabled: true });
    mocks.capsule.current = FIXTURE_MINIMAL_JS;
    useResultStore.setState({ autoRunGateReason: 'incomplete' });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useResultStore.setState({ autoRunGateReason: null });
  });

  it('lists the notices as inert rows and runs share and export from the menu', async () => {
    render(<DockOverflowMenu />);
    expect(screen.getByRole('status').textContent).toBe('Live updates paused');
    expect(screen.getByRole('status').getAttribute('data-gate-variant')).toBe('default');

    const trigger = screen.getByRole('button', { name: 'More dock actions' });
    fireEvent.click(trigger);
    const items = [...screen.getByRole('menu').querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    expect(items.map(item => item.textContent)).toEqual([
      'Live updates paused',
      'Auto-log',
      'Export run as capsule',
      'Copy share link',
    ]);
    expect(items[0]?.getAttribute('aria-disabled')).toBe('true');
    expect(items[1]?.getAttribute('aria-disabled')).toBe('true');
    expect(items[1]?.getAttribute('role')).toBe('menuitemcheckbox');
    expect(items[1]?.getAttribute('aria-checked')).toBe('true');
    expect(items[2]?.getAttribute('title')).toBe('Export this run as a JSON capsule');
    // Focus starts on the checked row, as in every app menu.
    expect(document.activeElement).toBe(items[1]);

    // Inert rows stay open; arrows wrap.
    fireEvent.click(items[1]!);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(items[1]!, { key: 'Home' });
    fireEvent.keyDown(items[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[3]);

    fireEvent.click(items[3]!);
    expect(mocks.emitCommand).toHaveBeenCalledWith('share.trigger', { trigger: 'button' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export run as capsule' }));
    await waitFor(() =>
      expect(mocks.exportCapsuleWithNotice).toHaveBeenCalledWith(FIXTURE_MINIMAL_JS)
    );
  });

  it('closes on Escape and returns focus to its trigger', () => {
    render(<DockOverflowMenu />);
    const trigger = screen.getByRole('button', { name: 'More dock actions' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('hands focus back to its trigger on Tab, so Tab continues from there', () => {
    render(<DockOverflowMenu />);
    const trigger = screen.getByRole('button', { name: 'More dock actions' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders nothing when no row applies', () => {
    mocks.activeTab.mockReturnValue(null);
    mocks.capsule.current = null;
    useResultStore.setState({ autoRunGateReason: null });
    const { container } = render(<DockOverflowMenu />);
    expect(container.innerHTML).toBe('');
  });
});
