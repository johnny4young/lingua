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

describe('JSON body tree', () => {
  const longUrl = `https://api.github.com/users/johnny4young/following/${'x'.repeat(200)}`;
  const json = (value: unknown, overrides: Partial<HttpResponseV1> = {}) =>
    makeResponse({ body: JSON.stringify(value), contentType: 'application/json; charset=utf-8', url: 'https://x.dev/users', ...overrides });
  const rows = () => screen.getAllByTestId('http-json-row').map((row) => row.textContent);
  const rowAt = (pointer: string) => document.querySelector<HTMLElement>(`[data-pointer="${pointer}"]`)!;
  const fold = (pointer: string) => fireEvent.click(rowAt(pointer).querySelector('button')!);

  it('shows one value per line with counts, folds a node, and cuts long strings with an expand control', () => {
    render(<HttpResponsePreview response={json({ owner: { login: 'johnny4young', following_url: longUrl }, ids: [1, 2] })} isExecuting={false} />);
    expect(rows()).toEqual(['owner: {2}', 'login: "johnny4young"', `following_url: "${`"${longUrl}"`.slice(1, 119)}…`, 'ids: [2]', '0: 1', '1: 2']);
    fireEvent.click(screen.getByRole('button', { name: 'Show the full value' }));
    expect(rows()[2]).toBe(`following_url: "${longUrl}"`);
    fold('/owner');
    expect(rows()).toEqual(['owner: {2}', 'ids: [2]', '0: 1', '1: 2']);
    expect(rowAt('/owner').getAttribute('aria-expanded')).toBe('false');
  });

  it('starts a large document folded below the top level and pages long arrays', () => {
    const big = { users: Array.from({ length: 450 }, (_, id) => ({ id, name: `user ${id}` })) };
    render(<HttpResponsePreview response={json(big)} isExecuting={false} />);
    expect(rows().slice(0, 3)).toEqual(['users: [450]', '0: {2}', '1: {2}']);
    expect(screen.getAllByTestId('http-json-row')).toHaveLength(201);
    fold('/users/1');
    expect(rows().slice(2, 5)).toEqual(['1: {2}', 'id: 1', 'name: "user 1"']);
    fold('/users/1');
    fireEvent.click(screen.getByTestId('http-json-more'));
    expect(screen.getAllByTestId('http-json-row')).toHaveLength(401);
    expect(screen.getByTestId('http-json-more').textContent).toBe('Show 50 more');
  });

  it('searches keys and values, highlighting the node and opening the way to it', () => {
    const big = { users: Array.from({ length: 450 }, (_, id) => ({ id, name: `user ${id}` })) };
    render(<HttpResponsePreview response={json(big)} isExecuting={false} />);
    fireEvent.change(screen.getByTestId('http-response-preview-search'), { target: { value: 'USER 420' } });
    expect(screen.getByTestId('http-response-preview-search-count').textContent).toBe('1 match');
    const hit = document.querySelector('[data-hit="true"]')!;
    expect(hit.getAttribute('data-pointer')).toBe('/users/420/name');
    expect(hit.querySelector('[data-testid="http-response-preview-body-match"]')?.textContent).toBe('user 420');
  });

  it('opens a node the user folded when a new search finds a match inside it, and folds again on request', () => {
    render(<HttpResponsePreview response={json({ items: [{ name: 'runtime' }, { name: 'editor' }] })} isExecuting={false} />);
    fold('/items/1');
    fireEvent.change(screen.getByTestId('http-response-preview-search'), { target: { value: 'editor' } });
    expect(document.querySelector('[data-hit="true"]')?.getAttribute('data-pointer')).toBe('/items/1/name');
    fold('/items/1');
    expect(document.querySelector('[data-hit="true"]')).toBeNull();
  });

  it('keeps long values on one line until Wrap is on, and Pretty off shows the raw text', () => {
    render(<HttpResponsePreview response={json({ url: longUrl })} isExecuting={false} />);
    const tree = screen.getByTestId('http-response-preview-body-tree');
    expect(tree.getAttribute('data-wrap')).toBe('false');
    // The toggles sit with the search, not in the header, where they would squeeze the status.
    expect(screen.getByTestId('http-response-preview-wrap-toggle').closest('label')?.parentElement).toBe(
      screen.getByTestId('http-response-preview-search').parentElement
    );
    fireEvent.click(screen.getByTestId('http-response-preview-wrap-toggle'));
    expect(tree.getAttribute('data-wrap')).toBe('true');
    fireEvent.click(screen.getByTestId('http-response-preview-pretty-toggle'));
    const raw = screen.getByTestId('http-response-preview-body-text');
    expect(raw.textContent).toBe(JSON.stringify({ url: longUrl }));
    expect(raw.className).toContain('whitespace-pre-wrap');
  });

  it('captures a hovered value by its path and marks values a rule already captures', () => {
    const onCaptureValue = vi.fn();
    render(
      <HttpResponsePreview
        response={json({ items: [{ id: 101, name: 'runtime' }] })}
        isExecuting={false}
        captures={[{ id: 'c1', source: 'body-json', path: 'items.0.id', targetVariable: 'lastId', enabled: true }]}
        onCaptureValue={onCaptureValue}
      />
    );
    expect(screen.getByTestId('http-json-captured').textContent).toBe('captured → lastId');
    expect(screen.queryByRole('button', { name: 'Capture items[0].id as a variable' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Capture items[0].name as a variable' }));
    expect(onCaptureValue).toHaveBeenCalledWith('items[0].name', ['items', 0, 'name']);
  });

  it('shows a body nested deeper than the tree draws as raw text', () => {
    const body = `${'['.repeat(5_000)}1${']'.repeat(5_000)}`;
    render(<HttpResponsePreview response={json(null, { body })} isExecuting={false} />);
    expect(screen.queryByTestId('http-response-preview-body-tree')).toBeNull();
    expect(screen.getByTestId('http-response-preview-body-text').textContent).toBe(body);
  });

  it('keeps row keys unique when a key looks like a paging row', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<HttpResponsePreview response={json({ a: Array.from({ length: 201 }, (_, i) => i), 'a#more': 1 })} isExecuting={false} />);
      expect(screen.getByTestId('http-json-more')).toBeTruthy();
      expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
    } finally {
      errors.mockRestore();
    }
  });

  it('is one tab stop that arrows move through, folds, expands and captures', () => {
    const onCaptureValue = vi.fn();
    render(
      <HttpResponsePreview
        response={json({ owner: { login: 'johnny4young', url: longUrl }, ids: [1, 2] })}
        isExecuting={false}
        onCaptureValue={onCaptureValue}
      />
    );
    const tree = screen.getByRole('tree');
    const tabStops = () => screen.getAllByRole('treeitem').filter((item) => item.tabIndex === 0);
    expect(tabStops().map((item) => item.dataset.pointer)).toEqual(['/owner']);
    expect(tree.querySelectorAll('button:not([tabindex="-1"])')).toHaveLength(0);
    const key = (name: string) => fireEvent.keyDown(document.activeElement!, { key: name });
    rowAt('/owner').focus();
    key('ArrowLeft');
    expect(rowAt('/owner').getAttribute('aria-expanded')).toBe('false');
    key('ArrowRight');
    expect(rowAt('/owner').getAttribute('aria-expanded')).toBe('true');
    key('ArrowRight');
    expect(document.activeElement).toBe(rowAt('/owner/login'));
    expect(tabStops().map((item) => item.dataset.pointer)).toEqual(['/owner/login']);
    key('c');
    expect(onCaptureValue).toHaveBeenCalledWith('owner.login', ['owner', 'login']);
    key('ArrowDown');
    key('Enter');
    expect(rowAt('/owner/url').textContent).toContain(longUrl);
    key('ArrowLeft');
    expect(document.activeElement).toBe(rowAt('/owner'));
    key('End');
    expect(document.activeElement).toBe(rowAt('/ids/1'));
    key('Home');
    expect(document.activeElement).toBe(rowAt('/owner'));
  });

  it('renders a body that is not valid JSON as text', () => {
    render(<HttpResponsePreview response={json(null, { body: '{"broken": ' })} isExecuting={false} />);
    expect(screen.getByTestId('http-response-preview-body-text').textContent).toBe('{"broken": ');
  });
});
