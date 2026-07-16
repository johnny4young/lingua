/**
 * RL-093 polish #7 — smoke tests for FloatingActionPill.
 *
 * Covers the pieces a regression would silently break:
 *   1. The pill renders with the active tab's language label and the
 *      mode-aware action button labelled by `currentWorkflow`.
 *   2. Clicking the action button fires `run()` (not `stop()`) when
 *      `isRunning === false`.
 *   3. Toolbar overlay actions live in the pill, while Settings remains
 *      a single trailing cog.
 *
 * The hook chain transitively pulls in esbuild-wasm (via useRunner →
 * executeTabManually) which fails to initialize under jsdom; the
 * `useRunner` hook is mocked to a deterministic stub.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { FloatingActionPill } from '@/components/Toolbar/FloatingActionPill';
import { useEditorStore } from '@/stores/editorStore';
import { useUIStore } from '@/stores/uiStore';
import { useBootstrapProgressStore } from '@/stores/bootstrapProgressStore';

const runMock = vi.fn();
const stopMock = vi.fn();
const isRunningRef = { current: false };

vi.mock('@/hooks/useRunner', () => ({
  useRunner: () => ({
    run: runMock,
    stop: stopMock,
    isRunning: isRunningRef.current,
    isInitializing: false,
  }),
}));

vi.mock('@/hooks/useEntitlement', () => ({
  currentEffectiveTier: () => 'pro',
  useEffectiveTier: () => 'pro',
}));
// Store-side tier checks (tab budget in editorTabActions) now read from
// stores/licenseSelectors, not the hook — mock it there too.
vi.mock('@/stores/licenseSelectors', () => ({
  currentEffectiveTier: () => 'pro',
}));

beforeEach(async () => {
  await initI18n();
  runMock.mockClear();
  stopMock.mockClear();
  isRunningRef.current = false;
  useEditorStore.setState({
    tabs: [
      {
        id: 'tab-ts',
        name: 'main.ts',
        language: 'typescript',
        content: 'console.log(1)',
        isDirty: false,
      },
    ],
    activeTabId: 'tab-ts',
    pendingReveal: null,
  });
  useUIStore.setState({ actionPillPosition: null });
  useBootstrapProgressStore.getState().clear();
});

function renderPill(props: ComponentProps<typeof FloatingActionPill> = {}) {
  return render(
    <I18nextProvider i18n={i18next}>
      <FloatingActionPill {...props} />
    </I18nextProvider>,
  );
}

describe('FloatingActionPill', () => {
  it('renders language label and workflow-aware action button', () => {
    renderPill();
    expect(screen.getByTestId('floating-action-pill')).toBeTruthy();
    expect(screen.getByTestId('action-pill-lang').textContent).toContain('TypeScript');
    // Default workflow when none is set is `'run'` per the unified
    // mode-aware button. The button must be present and not disabled.
    const run = screen.getByTestId('action-pill-run') as HTMLButtonElement;
    expect(run.disabled).toBe(false);
  });

  it('fires run() when the action button is clicked while idle', async () => {
    const user = userEvent.setup();
    renderPill();
    await user.click(screen.getByTestId('action-pill-run'));
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('shows the Settings cog only when onOpenSettings is provided', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPill();
    expect(screen.queryByTestId('action-pill-settings')).toBeNull();
    unmount();

    const onOpenSettings = vi.fn();
    renderPill({ onOpenSettings });
    const cog = screen.getByTestId('action-pill-settings');
    expect(cog).toBeTruthy();
    await user.click(cog);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('routes the moved toolbar shortcuts from the pill', async () => {
    const user = userEvent.setup();
    const onOpenQuickOpen = vi.fn();
    const onOpenPalette = vi.fn();
    const onOpenSnippets = vi.fn();
    const onOpenUtilities = vi.fn();

    renderPill({
      onOpenQuickOpen,
      onOpenPalette,
      onOpenSnippets,
      onOpenUtilities,
      utilitiesOpen: true,
    });

    await user.click(screen.getByTestId('action-pill-quick-open'));
    await user.click(screen.getByTestId('action-pill-search'));
    await user.click(screen.getByTestId('action-pill-snippets'));
    const utilitiesButton = screen.getByTestId('action-pill-utilities');
    expect(utilitiesButton.getAttribute('aria-pressed')).toBe('true');
    await user.click(utilitiesButton);

    expect(onOpenQuickOpen).toHaveBeenCalledOnce();
    expect(onOpenPalette).toHaveBeenCalledOnce();
    expect(onOpenSnippets).toHaveBeenCalledOnce();
    expect(onOpenUtilities).toHaveBeenCalledOnce();
  });

  it('creates a new tab when the current language is picked again', async () => {
    const user = userEvent.setup();
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js',
          name: 'main.js',
          language: 'javascript',
          content: 'console.log(1)',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-js',
      pendingReveal: null,
    });

    renderPill();
    await user.click(screen.getByTestId('action-pill-lang'));
    expect(screen.queryByText('Active')).toBeNull();
    let menu = screen.getByRole('menu');
    expect(within(menu).getByText('JS')).toBeTruthy();
    expect(within(menu).getByText('TS')).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Ruby/ })).toBeTruthy();
    await user.click(within(menu).getByRole('menuitem', { name: /JavaScript/ }));

    await user.click(screen.getByTestId('action-pill-lang'));
    menu = screen.getByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /JavaScript/ }));

    const javascriptTabs = useEditorStore
      .getState()
      .tabs.filter((tab) => tab.language === 'javascript');
    expect(javascriptTabs).toHaveLength(3);
  });

  it('does not leave an empty runtime separator for languages without runtime modes', () => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-go',
          name: 'main.go',
          language: 'go',
          content: 'package main',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-go',
      pendingReveal: null,
    });

    renderPill();

    expect(screen.queryByTestId('action-pill-runtime')).toBeNull();
    const structuralDividers = Array.from(
      document.body.querySelectorAll('.action-pill-divider'),
    ).filter((node) => !node.classList.contains('action-pill-meta-divider'));
    expect(structuralDividers).toHaveLength(1);
  });

  it('only shows bootstrap progress for the active tab language', async () => {
    renderPill();
    act(() => {
      useBootstrapProgressStore.getState().report({
        language: 'python',
        loadedBytes: 2 * 1024 * 1024,
        totalBytes: null,
      });
    });
    expect(screen.getByTestId('action-pill-run').textContent).not.toContain('Python');
    expect(screen.getByTestId('action-pill-run').textContent).not.toContain('MB');

    act(() => {
      useEditorStore.setState({
        tabs: [
          {
            id: 'tab-py',
            name: 'main.py',
            language: 'python',
            content: 'print(42)',
            isDirty: false,
          },
        ],
        activeTabId: 'tab-py',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('action-pill-run').textContent).toContain('Python');
      expect(screen.getByTestId('action-pill-run').textContent).toContain('2.0 MB');
    });
  });

  it('offers every implemented JS/TS runtime in the floating runtime picker', async () => {
    const user = userEvent.setup();
    renderPill();

    await user.click(screen.getByTestId('action-pill-runtime'));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByTestId('action-pill-runtime-option-worker')).toBeTruthy();
    expect(within(menu).getByTestId('action-pill-runtime-option-node')).toBeTruthy();
    expect(within(menu).getByTestId('action-pill-runtime-option-browser-preview')).toBeTruthy();
    expect(within(menu).getByTestId('action-pill-runtime-option-deno')).toBeTruthy();
    expect(within(menu).getByTestId('action-pill-runtime-option-bun')).toBeTruthy();

    await user.click(within(menu).getByTestId('action-pill-runtime-option-deno'));

    expect(
      useEditorStore.getState().tabs.find((tab) => tab.id === 'tab-ts')?.runtimeMode
    ).toBe('deno');
  });

  it('moves back to the handoff default when floating positions are reset', async () => {
    useUIStore.getState().setActionPillPosition({ x: 120, y: 64 });
    renderPill();
    const pill = screen.getByTestId('floating-action-pill');
    expect(pill.style.getPropertyValue('--floating-pill-x')).toBe('120px');

    act(() => {
      useUIStore.getState().resetFloatingPositions();
    });

    await waitFor(() => {
      expect(pill.style.getPropertyValue('--floating-pill-y')).toBe('44px');
      expect(pill.style.getPropertyValue('--floating-pill-x')).not.toBe('120px');
    });
  });
});
