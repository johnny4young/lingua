import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlResultPreview } from '../../../src/renderer/components/SqlWorkspace/SqlResultPreview';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import type { SqlResponseV1 } from '../../../src/shared/sqlWorkspace';

const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));

function response(): SqlResponseV1 {
  return {
    version: 1,
    status: 'success',
    rows: [
      { site: 'https://lingua.dev/docs', share: 0.25, active: true, logo: png },
      { site: 'not a url', share: 0.8, active: false, logo: null },
    ],
    columns: [
      { name: 'site', type: 'Utf8' },
      { name: 'share', type: 'Float64' },
      { name: 'active', type: 'Bool' },
      { name: 'logo', type: 'Binary' },
    ],
    rowCount: 2,
    durationMs: 4,
    tooLarge: false,
    statementCount: 1,
    recordedAt: '2026-11-01T10:00:00.000Z',
  };
}

const initialSettings = useSettingsStore.getState();
const openExternal = vi.fn(async () => true);

beforeEach(async () => {
  await i18next.changeLanguage('en');
  Object.defineProperty(window, 'lingua', { value: { openExternal }, configurable: true, writable: true });
  openExternal.mockClear();
});

afterEach(() => useSettingsStore.setState(initialSettings, true));

describe('SQL grid magics', () => {
  it('draws links, 0–1 bars, checks and thumbnails with Rich display on', () => {
    useSettingsStore.setState({ featureFlags: { richDisplay: true } });
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    const links = screen.getAllByTestId('sql-cell-link');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('title')).toBe('Cmd/Ctrl+click to open lingua.dev');
    expect(links[0]!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getAllByTestId('sql-cell-bar')).toHaveLength(2);
    expect(screen.getAllByTestId('sql-cell-check').map(cell => cell.textContent)).toEqual(['✓', '✗']);
    expect(screen.getAllByTestId('sql-cell-check')[1]!.getAttribute('aria-label')).toBe('false');
    expect(screen.getByTestId('sql-cell-thumb').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('opens a link only with Cmd or Ctrl and keeps a plain click for selection', () => {
    useSettingsStore.setState({ featureFlags: { richDisplay: true } });
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    const link = screen.getByTestId('sql-cell-link');
    // The app never navigates its own window to the cell's URL.
    expect(fireEvent.click(link)).toBe(false);
    expect(fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('sql-result-preview-row')[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(link, { metaKey: true });
    expect(openExternal).toHaveBeenCalledWith('https://lingua.dev/docs');
    fireEvent.click(link, { ctrlKey: true });
    expect(openExternal).toHaveBeenCalledTimes(2);
  });

  it('keeps plain text with the flag off', () => {
    render(<SqlResultPreview response={response()} isExecuting={false} rowDisplayLimit={100} />);
    expect(screen.queryByTestId('sql-cell-link')).toBeNull();
    expect(screen.queryByTestId('sql-cell-bar')).toBeNull();
    expect(screen.queryByTestId('sql-cell-thumb')).toBeNull();
  });
});
