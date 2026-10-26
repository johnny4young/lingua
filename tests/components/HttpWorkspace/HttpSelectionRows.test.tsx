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
});
