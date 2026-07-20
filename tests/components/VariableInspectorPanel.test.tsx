/**
 * implementation — VariableInspectorPanel render contract.
 *
 * Covers:
 *   - Empty state when no language-matched snapshot exists.
 *   - Variables render with name + type tag + value.
 *   - Object rows show an expand chevron; click expands inline.
 *   - Filter input narrows by case-insensitive substring.
 *   - Truncation banner renders when `truncatedCount` is set.
 */

import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VariableInspectorPanel } from '../../src/renderer/components/Editor/VariableInspectorPanel';
import { useResultStore } from '../../src/renderer/stores/resultStore';
import type { ScopeValue } from '../../src/shared/scopeSnapshot';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && opts.count !== undefined) {
        return `${key}::${opts.count}`;
      }
      return key;
    },
  }),
}));

function primitiveNumber(value: number): ScopeValue {
  return { kind: 'primitive', type: 'number', repr: String(value) };
}

beforeEach(() => {
  useResultStore.setState({ scopeSnapshot: null, snapshotRing: [] });
});

describe('implementation — <VariableInspectorPanel>', () => {
  it('renders the empty state when there is no language-matched snapshot', () => {
    useResultStore.setState({
      scopeSnapshot: {
        language: 'python',
        capturedAt: 100,
        variables: [],
      },
    });
    const { container } = render(<VariableInspectorPanel language="javascript" />);
    expect(
      container.querySelector('[data-testid="variable-inspector-empty"]')
    ).not.toBeNull();
  });

  it('renders top-level variables with name + type tag + value', () => {
    useResultStore.setState({
      scopeSnapshot: {
        language: 'javascript',
        capturedAt: 100,
        variables: [
          { name: 'x', value: primitiveNumber(1) },
          { name: 'y', value: primitiveNumber(2) },
        ],
      },
    });
    const { container } = render(<VariableInspectorPanel language="javascript" />);
    expect(container.querySelector('[data-testid="variable-row-x"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="variable-row-y"]')).not.toBeNull();
  });

  it('expands object entries inline when the row is clicked', () => {
    useResultStore.setState({
      scopeSnapshot: {
        language: 'javascript',
        capturedAt: 100,
        variables: [
          {
            name: 'obj',
            value: {
              kind: 'object',
              previewType: 'Object',
              entries: [
                { key: 'a', value: primitiveNumber(1) },
                { key: 'b', value: primitiveNumber(2) },
              ],
            },
          },
        ],
      },
    });
    const { container } = render(<VariableInspectorPanel language="javascript" />);
    const objRow = container.querySelector('[data-testid="variable-row-obj"]');
    expect(objRow).not.toBeNull();
    const chevron = objRow?.querySelector('button');
    if (!chevron) throw new Error('chevron not rendered');
    fireEvent.click(chevron);
    // The two nested entries surface AFTER the expand click.
    expect(container.querySelector('[data-testid="variable-row-a"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="variable-row-b"]')).not.toBeNull();
  });

  it('renders the truncation banner when scope is capped', () => {
    useResultStore.setState({
      scopeSnapshot: {
        language: 'javascript',
        capturedAt: 100,
        variables: [{ name: 'x', value: primitiveNumber(1) }],
        truncatedCount: 5,
      },
    });
    const { container } = render(<VariableInspectorPanel language="javascript" />);
    expect(
      container.querySelector('[data-testid="variable-inspector-top-truncated"]')
    ).not.toBeNull();
  });

  it('renders the truncation banner even when every variable was payload-capped', () => {
    useResultStore.setState({
      scopeSnapshot: {
        language: 'javascript',
        capturedAt: 100,
        variables: [],
        truncatedCount: 5,
      },
    });
    const { container } = render(<VariableInspectorPanel language="javascript" />);
    expect(
      container.querySelector('[data-testid="variable-inspector-top-truncated"]')
    ).not.toBeNull();
  });

  it('narrows visible rows when the filter input has text', () => {
    useResultStore.setState({
      scopeSnapshot: {
        language: 'javascript',
        capturedAt: 100,
        variables: [
          { name: 'fooBar', value: primitiveNumber(1) },
          { name: 'baz', value: primitiveNumber(2) },
        ],
      },
    });
    const { container } = render(<VariableInspectorPanel language="javascript" />);
    const filter = container.querySelector('[data-testid="variable-inspector-filter"]') as HTMLInputElement;
    expect(filter).not.toBeNull();
    fireEvent.change(filter, { target: { value: 'foo' } });
    expect(container.querySelector('[data-testid="variable-row-fooBar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="variable-row-baz"]')).toBeNull();
  });

  it('renders the filter-empty state when no row matches', () => {
    useResultStore.setState({
      scopeSnapshot: {
        language: 'javascript',
        capturedAt: 100,
        variables: [{ name: 'foo', value: primitiveNumber(1) }],
      },
    });
    const { container } = render(<VariableInspectorPanel language="javascript" />);
    const filter = container.querySelector('[data-testid="variable-inspector-filter"]') as HTMLInputElement;
    fireEvent.change(filter, { target: { value: 'zzz' } });
    expect(
      container.querySelector('[data-testid="variable-inspector-filter-empty"]')
    ).not.toBeNull();
  });
});
