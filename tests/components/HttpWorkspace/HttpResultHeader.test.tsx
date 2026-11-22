import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { downloadSpy } = vi.hoisted(() => ({ downloadSpy: vi.fn() }));
vi.mock('../../../src/renderer/utils/downloadTextFile', () => ({ downloadTextFile: downloadSpy }));

import { HttpResponsePreview } from '../../../src/renderer/components/HttpWorkspace/HttpResponsePreview';
import { HttpRequestList } from '../../../src/renderer/components/HttpWorkspace/HttpRequestList';
import { shortContentType } from '../../../src/renderer/components/HttpWorkspace/httpStatus';
import { subscribeCommand } from '../../../src/renderer/stores/commandBus';
import type { HttpResponseV1 } from '../../../src/shared/httpWorkspace';

function response(overrides: Partial<HttpResponseV1> = {}): HttpResponseV1 {
  return {
    version: 1,
    kind: 'success',
    status: 200,
    statusText: 'OK',
    url: 'https://x.dev/v1/services',
    finalUrl: 'https://x.dev/v1/services',
    headers: [
      { name: 'content-type', value: 'application/json; charset=utf-8' },
      { name: 'x-request-id', value: 'req_1' },
    ],
    body: '{"items":[{"id":101}]}',
    contentType: 'application/json; charset=utf-8',
    sizeBytes: 1843,
    durationMs: 142,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-11-11T14:02:07.000Z',
    ...overrides,
  };
}

const timing = { dnsMs: 8, connectMs: 21, tlsMs: 34, waitingMs: 68, downloadMs: 11, redirects: 0, redirectMs: 0 };

describe('HTTP result header', () => {
  it('reads the status as the numeral, then time, size and type, and keeps the pill attributes', () => {
    render(<HttpResponsePreview response={response()} isExecuting={false} />);
    expect(screen.getByTestId('result-header-workspace').textContent).toBe('HTTP');
    const numeral = screen.getByTestId('http-status-pill');
    expect(numeral.textContent).toBe('200ok');
    expect(numeral.getAttribute('title')).toBe('200 OK');
    expect(numeral.dataset.tone).toBe('success');
    expect(numeral.dataset.status).toBe('200');
    expect(screen.getByText('142 ms · 1.8 KiB · json')).toBeTruthy();
  });

  it('colours a failing status as an error and keeps the pill for a request that never answered', () => {
    const { rerender } = render(<HttpResponsePreview response={response({ status: 503, statusText: 'Service Unavailable' })} isExecuting={false} />);
    expect(screen.getByTestId('http-status-pill').querySelector('.result-numeral')?.getAttribute('data-tone')).toBe('error');

    rerender(<HttpResponsePreview response={response({ kind: 'network-error', status: 0, statusText: '' })} isExecuting={false} />);
    expect(screen.queryByTestId('result-header-numeral')).toBeNull();
    expect(screen.getByTestId('http-status-pill').dataset.kind).toBe('network-error');
  });

  it('orders the views Body, Headers with their count, Timing, Raw', () => {
    render(<HttpResponsePreview response={response()} isExecuting={false} />);
    const header = screen.getByTestId('result-header');
    const views = within(header)
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed') && !button.dataset.testid);
    expect(views.map((button) => button.textContent)).toEqual(['Body', 'Headers 2', 'Timing', 'Raw']);
  });

  it('draws the hop phases under the metrics and leaves the breakdown to the Timing view there', async () => {
    const user = userEvent.setup();
    render(<HttpResponsePreview response={response({ timing })} isExecuting={false} />);
    expect(screen.getByTestId('http-response-phases').querySelectorAll('[data-phase]')).toHaveLength(5);
    expect(screen.getByTestId('http-response-phases-label').textContent).toBe('DNS 8 · Connect 21 · TLS 34 · Waiting 68 · Download 11 ms');
    await user.click(screen.getByRole('button', { name: 'Timing' }));
    expect(screen.queryByTestId('http-response-phases-label')).toBeNull();
    expect(screen.getByTestId('http-timing-summary')).toBeTruthy();
  });

  it('filters from the header by focusing the body search, and saves the body', async () => {
    const user = userEvent.setup();
    render(<HttpResponsePreview response={response()} isExecuting={false} />);
    await user.click(screen.getByRole('button', { name: 'Raw' }));
    await user.click(screen.getByTestId('http-response-filter'));
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('http-response-preview-search')));
    await user.type(screen.getByTestId('http-response-preview-search'), 'items');
    expect(screen.getByTestId('http-response-filter').getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByTestId('http-response-export'));
    expect(downloadSpy).toHaveBeenCalledWith('{"items":[{"id":101}]}', 'response.json', 'application/json; charset=utf-8');
  });

  it('names the short content type', () => {
    expect(shortContentType('application/vnd.api+json; charset=utf-8')).toBe('json');
    expect(shortContentType('text/html')).toBe('html');
    expect(shortContentType('')).toBe('');
  });
});

describe('HTTP requests footer', () => {
  it('opens the import overlay', async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    const unsubscribe = subscribeCommand('overlay.openImport', opened);
    render(
      <HttpRequestList
        requests={[]}
        activeRequestId={null}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    await user.click(screen.getByTestId('http-request-list-import'));
    expect(opened).toHaveBeenCalledOnce();
    expect(screen.getByTestId('http-request-list-import').textContent).toBe('Import from Postman or cURL');
    unsubscribe();
  });
});
