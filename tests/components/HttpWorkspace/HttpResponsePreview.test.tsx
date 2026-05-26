import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HttpResponsePreview } from '../../../src/renderer/components/HttpWorkspace/HttpResponsePreview';
import type { HttpResponseV1 } from '../../../src/shared/httpWorkspace';

function makeResponse(overrides: Partial<HttpResponseV1> = {}): HttpResponseV1 {
  return {
    version: 1,
    kind: 'success',
    status: 200,
    statusText: 'OK',
    url: 'https://example.com/image.svg',
    finalUrl: 'https://example.com/image.svg',
    headers: [],
    body: '<svg xmlns="http://www.w3.org/2000/svg"><text>é</text></svg>',
    contentType: 'image/svg+xml',
    sizeBytes: 60,
    durationMs: 12,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-05-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('HttpResponsePreview', () => {
  it('renders image responses without throwing on Unicode bodies', () => {
    render(<HttpResponsePreview response={makeResponse()} isExecuting={false} />);
    const img = screen.getByTestId('http-response-preview-body-image');
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('falls back to text when image data cannot be encoded', () => {
    const originalTextEncoder = globalThis.TextEncoder;
    vi.stubGlobal('TextEncoder', class {
      encode(): Uint8Array {
        throw new Error('encode failed');
      }
    });
    try {
      render(
        <HttpResponsePreview response={makeResponse()} isExecuting={false} />
      );
      expect(screen.getByTestId('http-response-preview-body-text')).toBeTruthy();
    } finally {
      vi.stubGlobal('TextEncoder', originalTextEncoder);
    }
  });

  it('only opens CORS targets with an HTTP(S) URL', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    render(
      <HttpResponsePreview
        response={makeResponse({
          kind: 'cors-error',
          status: 0,
          url: 'javascript:alert(1)',
          finalUrl: 'javascript:alert(1)',
          body: '',
          contentType: '',
          errorMessage: 'blocked',
        })}
        isExecuting={false}
      />
    );
    expect(
      screen.queryByTestId('http-response-preview-open-external')
    ).toBeNull();
  });

  it('opens valid CORS targets with noreferrer isolation', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    render(
      <HttpResponsePreview
        response={makeResponse({
          kind: 'cors-error',
          status: 0,
          url: 'https://api.example.com/users',
          finalUrl: 'https://api.example.com/users',
          body: '',
          contentType: '',
          errorMessage: 'blocked',
        })}
        isExecuting={false}
      />
    );
    fireEvent.click(screen.getByTestId('http-response-preview-open-external'));
    expect(open).toHaveBeenCalledWith(
      'https://api.example.com/users',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
