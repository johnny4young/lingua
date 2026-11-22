import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { ResultHeader } from '../../../src/renderer/components/ui/ResultHeader';
import { HttpStatusPill } from '../../../src/renderer/components/HttpWorkspace/HttpStatusPill';
import type { HttpResponseV1 } from '../../../src/shared/httpWorkspaceSchema';

describe('ResultHeader meta line', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('keeps timing and size on one line and lets the status shrink first', () => {
    render(<ResultHeader status={<span data-testid="status">200 OK</span>} meta="385 ms · 5.6 KiB" />);
    const meta = screen.getByText('385 ms · 5.6 KiB');
    expect(meta.className).toContain('whitespace-nowrap');
    expect(meta.className).toContain('tabular-nums');
    expect(meta.parentElement?.className).toContain('shrink-0');
    expect(screen.getByTestId('status').parentElement?.className).toContain('min-w-0');
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
