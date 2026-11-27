import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HttpRequestList } from '../../../src/renderer/components/HttpWorkspace/HttpRequestList';
import { HttpResponseHistory } from '../../../src/renderer/components/HttpWorkspace/HttpResponseHistory';
import { createBlankHttpRequest, type HttpResponseV1 } from '../../../src/shared/httpWorkspace';

// Selection reads from the row's tint and weight, never from a strip along its leading edge.
const LEADING_STRIP = /\b(border-l|border-s|before:)/;

const response = (recordedAt: string): HttpResponseV1 => ({
  version: 1,
  kind: 'success',
  status: 200,
  statusText: 'OK',
  url: 'https://x.dev',
  finalUrl: 'https://x.dev',
  headers: [],
  body: '{}',
  contentType: 'application/json',
  sizeBytes: 2,
  durationMs: 3,
  tooLarge: false,
  redactedHeaders: [],
  recordedAt,
});

describe('HTTP selection rows', () => {
  it('marks the active request with a tint and weight', () => {
    const requests = [createBlankHttpRequest({ id: 'a' }), createBlankHttpRequest({ id: 'b' })];
    render(
      <HttpRequestList
        requests={requests}
        activeRequestId="a"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onOpenPipelines={vi.fn()}
        pipelineCount={0}
      />
    );
    const active = document.querySelector('[aria-current="true"]')!;
    expect(active.className).toContain('bg-bg-inset');
    expect(active.className).toContain('font-semibold');
    expect(active.className).not.toMatch(LEADING_STRIP);
  });

  it('marks the selected history entry the same way', () => {
    render(
      <HttpResponseHistory
        history={[response('2026-10-24T00:00:02.000Z'), response('2026-10-24T00:00:01.000Z')]}
        selectedIndex={1}
        onSelect={vi.fn()}
      />
    );
    const rows = screen.getAllByTestId('http-response-history-row');
    expect(rows[1]!.className).toContain('font-semibold');
    for (const row of rows) expect(row.className).not.toMatch(LEADING_STRIP);
  });

  it('draws each history row as a status dot, its code and a latency bar on a shared square-root scale', () => {
    render(
      <HttpResponseHistory
        history={[
          { ...response('2026-10-24T00:00:03.000Z'), durationMs: 100 },
          { ...response('2026-10-24T00:00:02.000Z'), status: 503, statusText: 'Service Unavailable', kind: 'server-error', durationMs: 2000 },
          { ...response('2026-10-24T00:00:01.000Z'), status: 0, statusText: '', kind: 'timeout', durationMs: 500 },
          { ...response('2026-10-24T00:00:00.000Z'), status: 304, statusText: 'Not Modified', durationMs: 20 },
        ]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />
    );
    const rows = screen.getAllByTestId('http-response-history-row');
    expect(rows.map((row) => row.dataset.tone)).toEqual(['ok', 'error', 'neutral', 'neutral']);
    expect(screen.getAllByTestId('http-response-history-status').map((status) => status.textContent)).toEqual(['200', '503', 'Timeout', '304']);
    const shares = screen.getAllByTestId('http-response-history-bar').map((bar) => Number(bar.style.getPropertyValue('--share')));
    expect(shares).toEqual([Math.sqrt(100 / 2000), 1, Math.sqrt(500 / 2000), Math.sqrt(20 / 2000)]);
    expect(rows[1]!.textContent).toContain('2.0 s');
  });
});

