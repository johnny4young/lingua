/**
 * UX Sweep T8 — guided tour dialog focus management.
 *
 * The tour panel already declared role=dialog + aria-modal but trapped
 * nothing. These tests assert that opening the tour moves focus into the
 * dialog, Escape skips the tour and restores focus to the trigger, and Tab
 * is trapped inside the dialog.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';

const settingsState = {
  hasCompletedTour: false,
  setHasCompletedTour: vi.fn(),
  suppressTourAutoStart: false,
  setSuppressTourAutoStart: vi.fn(),
};

vi.mock('../../src/renderer/stores/settingsStore', () => {
  const useSettingsStore = ((selector?: (state: unknown) => unknown) =>
    selector ? selector(settingsState) : settingsState) as ((
    selector?: unknown
  ) => unknown) & { getState: () => typeof settingsState };
  useSettingsStore.getState = () => settingsState;
  return { useSettingsStore };
});

const uiState = {
  openBottomPanel: vi.fn(),
  setSidebarVisible: vi.fn(),
};

vi.mock('../../src/renderer/stores/uiStore', () => {
  const useUIStore = ((selector?: (state: unknown) => unknown) =>
    selector ? selector(uiState) : uiState) as ((selector?: unknown) => unknown) & {
    getState: () => typeof uiState;
  };
  useUIStore.getState = () => uiState;
  return { useUIStore };
});

const editorState = {
  tabs: [{ id: 'tab-1' }],
  addTab: vi.fn(),
};

vi.mock('../../src/renderer/stores/editorStore', () => {
  const useEditorStore = ((selector?: (state: unknown) => unknown) =>
    selector ? selector(editorState) : editorState) as ((
    selector?: unknown
  ) => unknown) & { getState: () => typeof editorState };
  useEditorStore.getState = () => editorState;
  return { useEditorStore, createDefaultTab: vi.fn(() => ({ id: 'default' })) };
});

import { GuidedTourProvider } from '../../src/renderer/components/GuidedTour/GuidedTourProvider';
import { useGuidedTour } from '../../src/renderer/components/GuidedTour/guidedTourContext';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex !== -1
  );
}

function Harness() {
  const { startTour } = useGuidedTour();
  return (
    <div>
      {/* The first tour step + the start gate both wait on this selector. */}
      <div id="guided-tour-editor" />
      <button type="button" data-testid="trigger" onClick={() => void startTour()}>
        Take a tour
      </button>
    </div>
  );
}

function renderTour() {
  return render(
    <GuidedTourProvider
      controls={{
        closeOverlay: vi.fn(),
        openPalette: vi.fn(),
        openSnippets: vi.fn(),
      }}
    >
      <Harness />
    </GuidedTourProvider>
  );
}

describe('GuidedTour focus management (UX Sweep T8)', () => {
  beforeEach(async () => {
    settingsState.setSuppressTourAutoStart.mockClear();
    // jsdom does not implement scrollIntoView; the step highlighter calls it.
    Element.prototype.scrollIntoView = vi.fn();
    await i18next.changeLanguage('en');
  });

  it('moves focus into the dialog when the tour opens', async () => {
    renderTour();
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(document.activeElement).toBe(dialog));
  });

  it('Escape skips the tour and restores focus to the trigger', async () => {
    renderTour();
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('traps Tab focus inside the dialog', async () => {
    renderTour();
    fireEvent.click(screen.getByTestId('trigger'));
    const dialog = await screen.findByRole('dialog');
    const focusables = focusablesIn(dialog);
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Shift+Tab from the dialog container wraps to the last control', async () => {
    renderTour();
    fireEvent.click(screen.getByTestId('trigger'));
    const dialog = await screen.findByRole('dialog');
    // On open the container itself holds focus; Shift+Tab must stay trapped.
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    const focusables = focusablesIn(dialog);
    const last = focusables[focusables.length - 1]!;
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
