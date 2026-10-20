import { act, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { CommandBar } from '../../../src/renderer/components/Chrome';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';

vi.mock('../../../src/renderer/components/Toolbar/FloatingActionPill', () => ({
  FloatingActionPill: ({ docked, beforeSettings }: { docked?: boolean; beforeSettings?: unknown }) => (
    <div data-testid="command-bar-controls" data-docked={docked ? 'true' : 'false'}>
      {beforeSettings as never}
    </div>
  ),
}));

const initialEditorState = useEditorStore.getState();
const initialLingua = window.lingua;

beforeEach(async () => {
  await initI18n();
  await i18next.changeLanguage('en');
  act(() => {
    useEditorStore.setState({
      tabs: [{ id: 't', name: 'main.js', language: 'javascript', content: '', isDirty: true }],
      activeTabId: 't',
    });
  });
});

afterEach(() => {
  useEditorStore.setState(initialEditorState, true);
  window.lingua = initialLingua;
});

describe('CommandBar', () => {
  it('keeps the chrome landmarks and docks the run controls in one 48 px row', () => {
    render(<CommandBar showControls />);
    const bar = screen.getByTestId('app-chrome');
    expect(bar.className).toContain('h-12');
    expect(bar.className).toContain('toolbar-drag-region');
    expect(screen.getByTestId('app-chrome-filename').textContent).toBe('main.js');
    expect(screen.getByTestId('app-chrome-unsaved')).toBeTruthy();
    expect(screen.getByTestId('command-bar-controls').getAttribute('data-docked')).toBe('true');
    expect(screen.getByTestId('command-bar-controls').querySelector('[data-testid="license-badge"]')).toBeTruthy();
  });

  it('leaves room for the macOS traffic lights only on macOS', () => {
    window.lingua = { ...(initialLingua ?? {}), platform: 'darwin' } as never;
    const { unmount } = render(<CommandBar showControls />);
    expect(screen.getByTestId('app-chrome').className).toContain('pl-[84px]');
    unmount();
    window.lingua = { ...(initialLingua ?? {}), platform: 'web' } as never;
    render(<CommandBar showControls />);
    expect(screen.getByTestId('app-chrome').className).toContain('pl-3');
  });

  it('drops the controls in presenter mode but keeps the license badge', () => {
    render(<CommandBar showControls={false} />);
    expect(screen.queryByTestId('command-bar-controls')).toBeNull();
    expect(screen.getByTestId('license-badge')).toBeTruthy();
  });
});
