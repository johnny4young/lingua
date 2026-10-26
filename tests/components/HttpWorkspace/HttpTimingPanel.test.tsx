import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HttpResponseDelta, HttpTimingPanel } from '../../../src/renderer/components/HttpWorkspace/HttpTimingPanel';
import { HttpResponsePreview } from '../../../src/renderer/components/HttpWorkspace/HttpResponsePreview';
import type { HttpResponseV1 } from '../../../src/shared/httpWorkspace';

function response(overrides: Partial<HttpResponseV1> = {}): HttpResponseV1 {
  return {
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
    durationMs: 150,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-10-24T00:00:00.000Z',
    ...overrides,
  };
}

const timing = { dnsMs: 3, connectMs: 40, tlsMs: 47, waitingMs: 50, downloadMs: 2, redirects: 0, redirectMs: 0 };

describe('HttpTimingPanel', () => {
  it('lists each phase of the hop, draws the waterfall and gives the total', () => {
    render(<HttpTimingPanel response={response({ timing })} desktop />);
    expect(screen.getByTestId('http-timing').getAttribute('data-phases')).toBe('true');
    expect(screen.getByTestId('http-timing-summary').textContent).toBe('DNS 3 · Connect 40 · TLS 47 · Waiting 50 · Download 2 ms');
    expect(screen.getByRole('img', { name: 'Timing waterfall' }).children).toHaveLength(5);
    expect(screen.getByTestId('http-timing-tls').textContent).toBe('47 ms');
    expect(screen.getByTestId('http-timing-total').textContent).toBe('150 ms');
    expect(screen.queryByTestId('http-timing-redirects')).toBeNull();
  });

  it('leaves zero-length phases out of the waterfall and names the redirects', () => {
    render(<HttpTimingPanel response={response({ timing: { ...timing, tlsMs: 0, redirects: 2, redirectMs: 31 } })} desktop />);
    expect(screen.getByRole('img', { name: 'Timing waterfall' }).children).toHaveLength(4);
    expect(screen.getByTestId('http-timing-redirects').textContent).toBe('2 redirects before the final hop, 31 ms');
  });

  it('gives the total with a note when there are no phases', () => {
    const { rerender } = render(<HttpTimingPanel response={response()} desktop={false} />);
    expect(screen.getByTestId('http-timing').textContent).toContain('The browser reports only the total');
    rerender(<HttpTimingPanel response={response()} desktop />);
    expect(screen.getByTestId('http-timing').textContent).toContain('This response has no timing by phase.');
  });

  it('opens from the response tabs', () => {
    render(<HttpResponsePreview response={response({ timing })} isExecuting={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Timing' }));
    expect(screen.getByTestId('http-timing')).toBeTruthy();
  });
});

describe('HttpResponseDelta', () => {
  it('says how much faster or slower the response was than the previous one', () => {
    const { rerender } = render(<HttpResponseDelta response={response({ durationMs: 120 })} previous={response({ durationMs: 150 })} />);
    expect(screen.getByTestId('http-response-delta').getAttribute('data-direction')).toBe('faster');
    expect(screen.getByTestId('http-response-delta').textContent).toBe('▼ 30 ms30 ms faster than the previous response');
    rerender(<HttpResponseDelta response={response({ durationMs: 180 })} previous={response({ durationMs: 150 })} />);
    expect(screen.getByTestId('http-response-delta').getAttribute('title')).toBe('30 ms slower than the previous response');
  });

  it('says nothing without a comparable previous response', () => {
    const { container, rerender } = render(<HttpResponseDelta response={response()} previous={undefined} />);
    expect(container.textContent).toBe('');
    rerender(<HttpResponseDelta response={response()} previous={response({ status: 0, kind: 'network-error' })} />);
    expect(container.textContent).toBe('');
    rerender(<HttpResponseDelta response={response()} previous={response()} />);
    expect(container.textContent).toBe('');
  });
});
