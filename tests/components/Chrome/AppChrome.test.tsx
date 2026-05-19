import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { AppChrome } from '../../../src/renderer/components/Chrome';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useUpdateStore } from '../../../src/renderer/stores/updateStore';

const initialEditorState = useEditorStore.getState();
const initialUpdateState = useUpdateStore.getState();

function seedTab(opts: { name: string; isDirty?: boolean } = { name: 'main.js' }) {
  act(() => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js',
          name: opts.name,
          language: 'javascript',
          content: '',
          isDirty: opts.isDirty ?? false,
        },
      ],
      activeTabId: 'tab-js',
    });
  });
}

describe('AppChrome', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useEditorStore.setState(initialEditorState, true);
    useUpdateStore.setState(initialUpdateState, true);
  });

  it('renders the chrome row with mark, filename and license badge', () => {
    seedTab({ name: 'scratchpad.js' });
    render(<AppChrome />);

    expect(screen.getByTestId('app-chrome')).toBeTruthy();
    expect(screen.getByTestId('app-chrome-filename').textContent).toBe('scratchpad.js');
    expect(screen.getByTestId('license-badge')).toBeTruthy();
  });

  it('falls back to the untitled label when no tab is active', () => {
    render(<AppChrome />);

    expect(screen.getByTestId('app-chrome-filename').textContent).toBe('Untitled');
    expect(screen.queryByTestId('app-chrome-unsaved')).toBeNull();
  });

  it('renders the unsaved pill when the active tab is dirty', () => {
    seedTab({ name: 'draft.ts', isDirty: true });
    render(<AppChrome />);

    expect(screen.getByTestId('app-chrome-unsaved').textContent).toContain('unsaved');
  });

  it('routes the chrome search button to onOpenPalette', async () => {
    seedTab();
    const user = userEvent.setup();
    const onOpenPalette = vi.fn();
    render(<AppChrome onOpenPalette={onOpenPalette} />);

    await user.click(screen.getByTestId('app-chrome-search'));
    expect(onOpenPalette).toHaveBeenCalledOnce();
  });

  it('routes the chrome gear button to onOpenSettings', async () => {
    seedTab();
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(<AppChrome onOpenSettings={onOpenSettings} />);

    const settingsButton = screen.getByTestId('app-chrome-settings');
    expect(settingsButton.getAttribute('aria-label')).toBe('Open settings');
    await user.click(settingsButton);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('surfaces the update-ready chip only after an update is downloaded', async () => {
    seedTab();
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    const { rerender } = render(<AppChrome onOpenSettings={onOpenSettings} />);

    expect(screen.queryByTestId('app-chrome-update-ready')).toBeNull();

    act(() => {
      useUpdateStore.setState({ status: 'downloaded' });
    });
    rerender(<AppChrome onOpenSettings={onOpenSettings} />);

    const chip = screen.getByTestId('app-chrome-update-ready');
    expect(chip.textContent).toContain('Update ready');

    await user.click(chip);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('reflects the Spanish locale for filename fallback and search label', async () => {
    await i18next.changeLanguage('es');
    render(<AppChrome />);

    expect(screen.getByTestId('app-chrome-filename').textContent).toBe('Sin título');
    expect(screen.getByTestId('app-chrome-search').getAttribute('aria-label')).toBe(
      'Abrir paleta de comandos'
    );
  });
});
