import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HttpJsonTree } from '../../../src/renderer/components/HttpWorkspace/HttpJsonTree';
import { searchJson } from '../../../src/renderer/components/HttpWorkspace/httpJsonTreeModel';

const services = {
  items: [
    { id: 101, name: 'runtime', status: 'healthy', p95Ms: 118 },
    { id: 102, name: 'worker', status: 'healthy', p95Ms: 64 },
    { id: 104, name: 'billing', status: 'degraded', p95Ms: 231, tags: ['eu'] },
  ],
  meta: { cached: false, generatedAt: new Date(Date.now() - 60_000).toISOString(), accent: '#7FD8C4', next: null },
};

function tree(value: unknown, query = '', onCapture = vi.fn()) {
  render(<HttpJsonTree value={value} query={query} search={searchJson(value, query)} wrap={false} captured={new Map([['items.1.name', 'worker']])} onCapture={onCapture} />);
  return onCapture;
}

const row = (pointer: string) => document.querySelector<HTMLElement>(`[data-testid="http-json-row"][data-pointer="${pointer}"]`)!;
const cell = (pointer: string) => document.querySelector<HTMLElement>(`[data-testid="http-json-cell"][data-pointer="${pointer}"]`)!;

describe('HttpJsonTree answers', () => {
  it('shows an array of objects as a table with bars on the columns that measure', () => {
    tree(services);
    expect(row('/items').dataset.table).toBe('true');
    expect(screen.getByTestId('http-json-table-tag').textContent).toBe('array·3 of object');
    expect(screen.getByTestId('http-json-table-toggle').textContent).toBe('shown as a table');
    const heads = [...screen.getByTestId('http-json-table').querySelectorAll('th')].map((th) => th.textContent);
    expect(heads).toEqual(['', 'id', 'name', 'status', 'p95Ms', 'tags']);
    expect(screen.getAllByTestId('http-json-table-row')).toHaveLength(3);
    // Keys never measure; p95Ms bars run against its largest value.
    expect(cell('/items/0/id').querySelector('.answer-object-hbar')).toBeNull();
    expect(cell('/items/2/p95Ms').querySelector<HTMLElement>('.answer-object-hbar')?.style.width).toBe('56px');
    expect(cell('/items/1/p95Ms').querySelector<HTMLElement>('.answer-object-hbar')?.style.width).toBe(`${(64 / 231) * 56}px`);
    expect(cell('/items/2/tags').textContent).toBe('[…1]');
    expect(cell('/items/0/tags').textContent).toBe('');
    expect(cell('/items/1/name').dataset.captured).toBe('worker');
  });

  it('reads leaves with the answer grammar: pills, colour swatches and relative dates', () => {
    tree(services);
    expect(row('/meta/cached').querySelector('.answer-object-value')?.getAttribute('data-tone')).toBe('boolean');
    expect(row('/meta/next').querySelector('.answer-object-value')?.getAttribute('data-tone')).toBe('none');
    expect(row('/meta/accent').querySelector('[data-testid="http-json-colour"]')?.textContent).toBe('#7FD8C4');
    const date = row('/meta/generatedAt');
    expect(date.querySelector('.answer-object-value')?.getAttribute('data-tone')).toBe('date');
    expect(date.querySelector('[data-testid="http-json-date-note"]')?.textContent).toMatch(/ · 1 min\. ago$/);
  });

  it('switches an array between table and tree with T or its toggle, and captures a cell', () => {
    const onCapture = tree(services);
    fireEvent.click(cell('/items/0/name').querySelector('button')!);
    expect(onCapture).toHaveBeenCalledWith('items[0].name', ['items', 0, 'name']);
    row('/items').focus();
    fireEvent.keyDown(row('/items'), { key: 't' });
    expect(screen.queryByTestId('http-json-table')).toBeNull();
    expect(row('/items/0/name')).toBeTruthy();
    expect(screen.getByTestId('http-json-table-toggle').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('http-json-table-toggle'));
    expect(screen.getByTestId('http-json-table')).toBeTruthy();
  });

  it('marks the cell that holds a search hit, even inside a nested value', () => {
    tree(services, 'eu');
    expect(cell('/items/2/tags').dataset.hit).toBe('true');
    tree({ list: [{ a: 1 }, { a: 2 }] }, '2');
    expect(cell('/list/1/a').dataset.hit).toBe('true');
  });

  it('keeps a single object, mixed arrays and wide objects as a tree', () => {
    const wide = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i]));
    tree({ one: [{ a: 1 }], mixed: [{ a: 1 }, 2], wide: [wide, wide] });
    expect(screen.queryByTestId('http-json-table')).toBeNull();
  });
});
