import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { ResultHeader } from '../../../src/renderer/components/ui/ResultHeader';
import { HttpStatusPill } from '../../../src/renderer/components/HttpWorkspace/HttpStatusPill';
import type { HttpResponseV1 } from '../../../src/shared/httpWorkspaceSchema';

describe('ResultHeader meta line', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('keeps each reading on one line, breaks only after a separator and lets the status shrink first', () => {
    render(<ResultHeader status={<span data-testid="status">200 OK</span>} meta="385 ms · 5.6 KiB" />);
    const meta = screen.getByTestId('result-header-meta');
    expect(meta.textContent).toBe('385 ms · 5.6 KiB');
    expect(meta.className).toContain('whitespace-nowrap');
    expect(meta.querySelectorAll('.whitespace-normal')).toHaveLength(1);
    expect(meta.className).toContain('tabular-nums');
    expect(meta.parentElement?.className).toContain('shrink-0');
    expect(screen.getByTestId('status').parentElement?.className).toContain('min-w-0');
  });

  it('heads a tool with its own tag, a numeral with words on either side and testable views', () => {
    render(
      <ResultHeader
        tag="TIME"
        numeral={{ lead: 'hace', value: '3', unit: 'h' }}
        tabs={[{ id: 'decode', label: 'Decode', testId: 'mode-decode' }]}
        activeTab="decode"
      />
    );
    expect(screen.getByTestId('result-header-tag').textContent).toBe('TIME');
    expect(screen.queryByTestId('result-header-workspace')).toBeNull();
    const numeral = screen.getByTestId('result-header-numeral');
    expect(Array.from(numeral.querySelectorAll('.result-numeral > span')).map((part) => part.className)).toEqual([
      'result-numeral-unit',
      'result-numeral-value',
      'result-numeral-unit',
    ]);
    expect(numeral.textContent).toBe('hace3h');
    expect(screen.getByTestId('mode-decode').getAttribute('aria-pressed')).toBe('true');
  });

  it('sets a word numeral smaller than digits', () => {
    render(<ResultHeader tag="JWT" numeral={{ value: 'expired', unit: '2 hr. ago', word: true }} />);
    expect(screen.getByTestId('result-header-numeral').querySelector('.result-numeral')?.hasAttribute('data-word')).toBe(true);
  });

  it('reads tag, numeral with its unit, metrics over a bar, views and actions in that order', async () => {
    const onTabChange = vi.fn();
    const onExport = vi.fn();
    render(
      <ResultHeader
        workspace="sql"
        numeral={{ value: '12', unit: 'rows', attributes: { 'data-testid': 'rows' } }}
        meta="38 ms"
        metaTrailing={<span> · statement 1 of 2</span>}
        phases={{ segments: [{ key: 'execute', ms: 31, color: 'red' }], label: 'execute 31 ms', testId: 'bar' }}
        tabs={[
          { id: 'table', label: 'Table' },
          { id: 'json', label: 'JSON' },
        ]}
        activeTab="table"
        onTabChange={onTabChange}
        actions={[{ id: 'export', glyph: 'export', label: 'Export', onClick: onExport, testId: 'export' }]}
      />
    );
    const header = screen.getByTestId('result-header');
    expect(header.dataset.density).toBe('pane');
    expect(screen.getByTestId('result-header-workspace').textContent).toBe('SQL');
    expect(screen.getByTestId('rows').querySelector('.result-numeral')?.getAttribute('data-size')).toBe('lg');
    expect(screen.getByTestId('rows').querySelector('.result-numeral-unit')?.textContent).toBe('rows');
    expect(header.textContent).toMatch(/^SQL12rows38 ms · statement 1 of 2execute 31 msTableJSON/);
    expect(screen.getByTestId('bar').parentElement?.textContent).toBe('38 ms · statement 1 of 2');
    expect(screen.getByTestId('bar').getAttribute('title')).toBe('execute 31 ms');
    expect(screen.getByTestId('bar-label').parentElement?.className).toContain('flex-[1_1_0]');

    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'JSON' }));
    expect(onTabChange).toHaveBeenCalledWith('json');
    screen.getByRole('button', { name: 'JSON' }).focus();
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByTestId('export'));
    await user.keyboard('{Enter}');
    expect(onExport).toHaveBeenCalledOnce();
  });

  it('uses the smaller numeral in compact density', () => {
    render(<ResultHeader density="compact" workspace="code" numeral={{ value: '1.24', unit: 's', tone: 'error' }} />);
    const numeral = screen.getByTestId('result-header-numeral').querySelector('.result-numeral');
    expect(numeral?.getAttribute('data-size')).toBe('md');
    expect(numeral?.getAttribute('data-tone')).toBe('error');
    expect(screen.getByTestId('result-header-workspace').textContent).toBe('CODE');
  });

  it('truncates a long HTTP status text with the full text as a tooltip', () => {
    const response = {
      kind: 'http',
      status: 503,
      statusText: 'Service Unavailable Because The Upstream Gateway Timed Out',
    } as unknown as HttpResponseV1;
    render(<HttpStatusPill response={response} />);
    const pill = screen.getByTestId('http-status-pill');
    expect(pill.getAttribute('title')).toBe(`503 ${response.statusText}`);
    expect(pill.querySelector('.truncate')?.textContent).toBe(`503 ${response.statusText}`);
  });
});

describe('ResultHeader on a narrow pane', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });
  afterEach(() => vi.restoreAllMocks());

  const tabs = [
    { id: 'table', label: 'Table' },
    { id: 'json', label: 'JSON' },
    { id: 'profile', label: 'Profile' },
  ];
  const renderAt = (width: number, onTabChange = vi.fn()) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width } as DOMRect);
    render(
      <ResultHeader
        workspace="sql"
        numeral={{ value: '12', unit: 'rows' }}
        meta="38 ms · statement 1 of 2"
        tabs={tabs}
        activeTab="table"
        onTabChange={onTabChange}
        actions={[{ id: 'export', glyph: 'export', label: 'Export', onClick: vi.fn(), testId: 'export' }]}
        trailing={(folded) => <span data-testid="trailing">{folded ? 'folded' : 'wide'}</span>}
        foldViewsBelow={640}
      />
    );
    return onTabChange;
  };

  it('folds the views into one menu and keeps the row from wrapping', async () => {
    const onTabChange = renderAt(564);
    const header = screen.getByTestId('result-header');
    expect(header.dataset.folded).toBe('true');
    expect(header.className).toContain('flex-nowrap');
    expect(screen.getByTestId('result-header-meta').parentElement?.className).toContain('min-w-0');
    expect(screen.queryByRole('button', { name: 'JSON' })).toBeNull();
    expect(screen.getByTestId('trailing').textContent).toBe('folded');
    expect(screen.getByTestId('export')).toBeTruthy();

    const user = userEvent.setup();
    const trigger = screen.getByTestId('result-header-views');
    expect(trigger.textContent).toBe('Table');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Table' });
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Table', 'true'],
      ['JSON', 'false'],
      ['Profile', 'false'],
    ]);
    expect(menu).toBeTruthy();
    await user.click(screen.getByTestId('result-header-view-profile'));
    expect(onTabChange).toHaveBeenCalledWith('profile');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps under the numeral below 420 px, still folded', () => {
    renderAt(331);
    const header = screen.getByTestId('result-header');
    expect(header.dataset.folded).toBe('true');
    expect(header.className).toContain('flex-wrap');
  });

  it('keeps the views as buttons on a wide pane', () => {
    renderAt(900);
    expect(screen.getByTestId('result-header').dataset.folded).toBeUndefined();
    expect(screen.getByRole('button', { name: 'JSON' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('trailing').textContent).toBe('wide');
  });
});
