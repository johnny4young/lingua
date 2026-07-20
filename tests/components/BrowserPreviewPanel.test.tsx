/**
 * implementation — BrowserPreviewPanel surface tests.
 *
 * Covers:
 *
 *   - The iframe element registers with the bridge on mount + the
 *     ref clears on unmount (the runner's only handle).
 *   - The empty-state overlay renders when the active tab is not
 *     JS/TS or its runtimeMode is not `browser-preview`.
 *   - The inspect button is wired through `window.open` for the
 *     web build; a refused popup surfaces the
 *     `browserPreview.inspect.blocked` error.
 *   - Status text reflects `isManualRunning` / `error` states.
 *   - Spanish locale renders the localized panel copy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { BrowserPreviewPanel } from '@/components/BrowserPreview/BrowserPreviewPanel';
import { useEditorStore } from '@/stores/editorStore';
import { useResultStore } from '@/stores/resultStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  getActiveBrowserPreviewIframe,
  _resetBrowserPreviewBridgeForTesting,
} from '@/runtime/browserPreviewBridge';
import type { FileTab } from '@/types';

function seedActiveTab(overrides: Partial<FileTab> = {}): void {
  const tab: FileTab = {
    id: 'tab-1',
    name: 'index.js',
    language: 'javascript',
    content: '',
    isDirty: false,
    runtimeMode: 'browser-preview',
    ...overrides,
  };
  useEditorStore.setState({
    tabs: [tab],
    activeTabId: tab.id,
  });
}

describe('BrowserPreviewPanel', () => {
  const initialEditor = useEditorStore.getState();
  const initialResult = useResultStore.getState();
  const initialSettings = useSettingsStore.getState();

  beforeEach(async () => {
    _resetBrowserPreviewBridgeForTesting();
    useEditorStore.setState(initialEditor, true);
    useResultStore.setState(initialResult, true);
    useSettingsStore.setState(initialSettings, true);
    await i18next.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    _resetBrowserPreviewBridgeForTesting();
    useEditorStore.setState(initialEditor, true);
    useResultStore.setState(initialResult, true);
    useSettingsStore.setState(initialSettings, true);
    await i18next.changeLanguage('en');
    vi.restoreAllMocks();
  });

  it('registers the iframe ref with the bridge on mount', () => {
    seedActiveTab();
    render(<BrowserPreviewPanel />);
    const iframe = screen.getByTestId('browser-preview-iframe');
    expect(getActiveBrowserPreviewIframe()).toBe(iframe);
  });

  it('clears the bridge registration on unmount', () => {
    seedActiveTab();
    const { unmount } = render(<BrowserPreviewPanel />);
    expect(getActiveBrowserPreviewIframe()).not.toBeNull();
    unmount();
    expect(getActiveBrowserPreviewIframe()).toBeNull();
  });

  it('hides the empty-state overlay when active tab is JS/TS in browser-preview mode', () => {
    seedActiveTab({ language: 'javascript', runtimeMode: 'browser-preview' });
    render(<BrowserPreviewPanel />);
    expect(screen.queryByTestId('browser-preview-empty-overlay')).toBeNull();
  });

  it('shows the empty-state overlay for non-JS/TS tabs', () => {
    seedActiveTab({ language: 'python', runtimeMode: undefined });
    render(<BrowserPreviewPanel />);
    expect(screen.queryByTestId('browser-preview-empty-overlay')).not.toBeNull();
  });

  it('shows the empty-state overlay when JS/TS tab is in Worker mode', () => {
    seedActiveTab({ language: 'javascript', runtimeMode: 'worker' });
    render(<BrowserPreviewPanel />);
    expect(screen.queryByTestId('browser-preview-empty-overlay')).not.toBeNull();
  });

  it('renders the running status when a manual run is in flight', () => {
    seedActiveTab();
    useResultStore.setState({ ...useResultStore.getState(), isManualRunning: true });
    render(<BrowserPreviewPanel />);
    const status = screen.getByTestId('browser-preview-status');
    expect(status.textContent).toMatch(/running/i);
  });

  it('renders the live-refresh status and effective interval', () => {
    seedActiveTab();
    useResultStore.setState({ ...useResultStore.getState(), isAutoRunning: true });
    render(<BrowserPreviewPanel />);

    expect(screen.getByTestId('browser-preview-status').textContent).toMatch(
      /refreshing/i
    );
    expect(
      screen.getByTestId('browser-preview-auto-refresh-status').textContent
    ).toMatch(/300 ms/i);
  });

  it('shows a first-line Off override in the footer', () => {
    seedActiveTab({
      content: '// @preview-refresh off\ndocument.body.textContent = "manual";',
    });
    render(<BrowserPreviewPanel />);

    expect(
      screen.getByTestId('browser-preview-auto-refresh-status').textContent
    ).toMatch(/off/i);
  });

  it('renders the runtime-error status when the store carries an error', () => {
    seedActiveTab();
    useResultStore.setState({
      ...useResultStore.getState(),
      error: 'boom',
      isManualRunning: false,
    });
    render(<BrowserPreviewPanel />);
    const status = screen.getByTestId('browser-preview-status');
    expect(status.textContent).toMatch(/surfaced an error/i);
  });

  it('opens a new window when the inspect button is clicked', async () => {
    seedActiveTab();
    render(<BrowserPreviewPanel />);
    const iframe = screen.getByTestId('browser-preview-iframe') as HTMLIFrameElement;
    // Seed the iframe srcdoc so the inspect path has something to
    // serialize as an opaque-origin data URL.
    Object.defineProperty(iframe, 'srcdoc', {
      configurable: true,
      value: '<!DOCTYPE html><html><body><h1>hi</h1></body></html>',
      writable: true,
    });

    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue({ closed: false } as unknown as Window);

    await userEvent.click(screen.getByTestId('browser-preview-inspect-button'));
    const [url, target, features] = openSpy.mock.calls[0] ?? [];
    expect(url).toMatch(/^data:text\/html;charset=utf-8,/u);
    expect(
      decodeURIComponent(String(url).replace(/^data:text\/html;charset=utf-8,/u, ''))
    ).toContain('<h1>hi</h1>');
    expect(target).toBe('_blank');
    expect(features).toBe('noopener,noreferrer');
    expect(screen.queryByTestId('browser-preview-inspect-error')).toBeNull();
  });

  it('surfaces the blocked-popup error when window.open returns null', async () => {
    seedActiveTab();
    render(<BrowserPreviewPanel />);
    const iframe = screen.getByTestId('browser-preview-iframe') as HTMLIFrameElement;
    Object.defineProperty(iframe, 'srcdoc', {
      configurable: true,
      value: '<!DOCTYPE html><html><body></body></html>',
      writable: true,
    });

    vi.spyOn(window, 'open').mockReturnValue(null);

    await userEvent.click(screen.getByTestId('browser-preview-inspect-button'));
    expect(screen.queryByTestId('browser-preview-inspect-error')).not.toBeNull();
  });

  it('renders Spanish copy when the locale is es', async () => {
    seedActiveTab();
    await i18next.changeLanguage('es');
    render(<BrowserPreviewPanel />);
    // Multiple elements carry the localized phrase (title +
    // description). Confirm at least one survives the locale flip.
    const matches = screen.getAllByText(/Vista previa del navegador/i);
    expect(matches.length).toBeGreaterThan(0);
  });
});
