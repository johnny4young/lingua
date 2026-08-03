import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ mounts: 0 }));
const notebookExport = vi.hoisted(() => ({
  load: vi.fn(),
  exportActive: vi.fn(),
}));

vi.mock('../../src/renderer/runtime/exportActiveNotebookLoader', () => ({
  loadActiveNotebookExporter: notebookExport.load,
}));

vi.mock('../../src/renderer/components/CommandPalette/CommandPalette', async () => {
  const React = await import('react');

  return {
    CommandPalette: ({
      variant = 'all',
      onExportActiveNotebookLinguanb,
    }: {
      variant?: 'all' | 'recent';
      onExportActiveNotebookLinguanb: () => void;
    }) => {
      const [mountId] = React.useState(() => ++lifecycle.mounts);
      return React.createElement(
        'div',
        { 'data-testid': 'mock-command-palette' },
        React.createElement('span', null, `${mountId}:${variant}`),
        React.createElement(
          'button',
          { type: 'button', onClick: onExportActiveNotebookLinguanb },
          'Export notebook'
        )
      );
    },
  };
});

vi.mock('../../src/renderer/components/Recipes/RecipesOverlay', () => {
  return {
    RecipesOverlay: () => <div data-testid="mock-recipes-overlay">recipes</div>,
  };
});

import { AppOverlays, type AppOverlaysProps } from '../../src/renderer/components/AppOverlays';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

const initialEditorState = useEditorStore.getState();
const initialUiState = useUIStore.getState();

const callbacks: Omit<AppOverlaysProps, 'overlay'> = {
  openOverlay: vi.fn(),
  closeOverlay: vi.fn(),
  onStartGuidedTour: vi.fn(),
  onOpenDeveloperUtility: vi.fn(),
  run: vi.fn(),
  isRunning: false,
  exportProjectBundle: vi.fn(),
};

describe('AppOverlays', () => {
  beforeEach(() => {
    lifecycle.mounts = 0;
    useEditorStore.setState({ ...initialEditorState, tabs: [], activeTabId: null }, true);
    useUIStore.setState({ ...initialUiState, statusNotice: null }, true);
    notebookExport.load.mockResolvedValue({
      exportActiveNotebookAsLinguanb: notebookExport.exportActive,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Overlays load behind a lazy boundary, so the first paint of each is a
  // Suspense fallback and the queries have to be async. The behaviour under
  // test is unchanged: switching variant must REMOUNT (mount id 1 -> 2), not
  // reuse the palette with new props.
  //
  // The assertions wait on the TEXT, not on the element. `findByTestId` only
  // waits for presence, and after the rerender the previous palette is still
  // in the DOM — so it would resolve against the stale node and assert the
  // old mount id.
  it('remounts the command palette when switching to recent commands', async () => {
    const { rerender } = render(<AppOverlays overlay="palette" {...callbacks} />);
    expect(await screen.findByText('1:all')).toBeTruthy();

    rerender(<AppOverlays overlay="recent-commands" {...callbacks} />);
    expect(await screen.findByText('2:recent')).toBeTruthy();
    // Exactly one palette is mounted; the old one is gone, not hidden.
    expect(screen.getAllByTestId('mock-command-palette')).toHaveLength(1);
  });

  it('renders Recipes through the same single overlay slot', async () => {
    const { rerender } = render(<AppOverlays overlay="recipes" {...callbacks} />);
    expect(await screen.findByTestId('mock-recipes-overlay')).toBeTruthy();

    rerender(<AppOverlays overlay="palette" {...callbacks} />);
    expect(await screen.findByText('1:all')).toBeTruthy();
    expect(screen.queryByTestId('mock-recipes-overlay')).toBeNull();
  });

  it('keeps the exporter unloaded when no notebook is active', async () => {
    useUIStore.getState().pushStatusNotice({
      tone: 'info',
      messageKey: 'onboarding.firstRun.message',
      priority: 'high',
    });
    render(<AppOverlays overlay="palette" {...callbacks} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Export notebook' }));

    expect(notebookExport.load).not.toHaveBeenCalled();
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'info',
      messageKey: 'notebook.notice.exportNoActiveNotebook',
      priority: 'high',
    });
  });

  it('loads and runs the exporter for an active notebook', async () => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'notebook-1',
          name: 'Example.linguanb',
          language: 'javascript',
          content: '',
          isDirty: false,
          kind: 'notebook',
        },
      ],
      activeTabId: 'notebook-1',
    });
    render(<AppOverlays overlay="palette" {...callbacks} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Export notebook' }));

    await waitFor(() => expect(notebookExport.exportActive).toHaveBeenCalledTimes(1));
    expect(notebookExport.load).toHaveBeenCalledTimes(1);
  });

  it('surfaces exporter loading failures without leaking the rejection', async () => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'notebook-1',
          name: 'Example.linguanb',
          language: 'javascript',
          content: '',
          isDirty: false,
          kind: 'notebook',
        },
      ],
      activeTabId: 'notebook-1',
    });
    notebookExport.load.mockRejectedValueOnce(new Error('chunk unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<AppOverlays overlay="palette" {...callbacks} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Export notebook' }));

    await waitFor(() =>
      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'error',
        messageKey: 'notebook.notice.exportFailed',
      })
    );
    expect(notebookExport.exportActive).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '[notebook-export] Failed to load exporter',
      expect.any(Error)
    );
    consoleError.mockRestore();
  });
});
