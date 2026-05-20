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

  it('keeps command and settings icons out of the title chrome', () => {
    seedTab();
    render(<AppChrome />);

    expect(screen.queryByTestId('app-chrome-quick-open')).toBeNull();
    expect(screen.queryByTestId('app-chrome-search')).toBeNull();
    expect(screen.queryByTestId('app-chrome-snippets')).toBeNull();
    expect(screen.queryByTestId('app-chrome-utilities')).toBeNull();
    expect(screen.queryByTestId('app-chrome-settings')).toBeNull();
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

  it('reflects the Spanish locale for filename fallback', async () => {
    await i18next.changeLanguage('es');
    render(<AppChrome />);

    expect(screen.getByTestId('app-chrome-filename').textContent).toBe('Sin título');
  });
});
