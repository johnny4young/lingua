import { act } from 'react';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  comparableSnapshotCountFor,
  hasComparableSnapshotFor,
  hasScopeSnapshotFor,
  scopeSnapshotVariableCountFor,
  useResultStore,
} from '../../src/renderer/stores/resultStore';
import type { ResultSnapshot } from '../../src/renderer/stores/resultStore';
import type { ScopeSnapshot } from '../../src/shared/scopeSnapshot';

/**
 * implementation — selector unit tests (implementation note) + a render-count regression
 * (implementation note) that locks the core acceptance criterion: a component that
 * subscribes through the new primitive selectors re-renders only when
 * the derived value actually changes, NOT on every snapshotRing /
 * scopeSnapshot reference replacement.
 */

function makeSnapshot(language: string): ResultSnapshot {
  return {
    language,
    capturedAt: 0,
    lineResults: [],
    fullOutput: '',
    hasError: false,
  };
}

function makeScope(language: string, variableCount: number): ScopeSnapshot {
  return {
    language,
    capturedAt: 0,
    // The selectors only read `variables.length`; build a length-N array
    // without depending on the full VariableSnapshot shape.
    variables: Array.from({ length: variableCount }, (_, index) => ({
      name: `v${index}`,
    })) as unknown as ScopeSnapshot['variables'],
  };
}

describe('resultStore active-snapshot selectors', () => {
  describe('hasComparableSnapshotFor', () => {
    it('is true only when a snapshot matches the language', () => {
      const state = { snapshotRing: [makeSnapshot('javascript'), makeSnapshot('python')] };
      expect(hasComparableSnapshotFor(state, 'javascript')).toBe(true);
      expect(hasComparableSnapshotFor(state, 'go')).toBe(false);
    });

    it('is false for an undefined language or an empty ring', () => {
      expect(hasComparableSnapshotFor({ snapshotRing: [] }, 'javascript')).toBe(false);
      expect(
        hasComparableSnapshotFor({ snapshotRing: [makeSnapshot('javascript')] }, undefined),
      ).toBe(false);
    });
  });

  describe('comparableSnapshotCountFor', () => {
    it('counts only snapshots matching the language', () => {
      const state = {
        snapshotRing: [
          makeSnapshot('javascript'),
          makeSnapshot('python'),
          makeSnapshot('javascript'),
        ],
      };
      expect(comparableSnapshotCountFor(state, 'javascript')).toBe(2);
      expect(comparableSnapshotCountFor(state, 'python')).toBe(1);
      expect(comparableSnapshotCountFor(state, 'go')).toBe(0);
    });

    it('returns 0 for an undefined language', () => {
      expect(
        comparableSnapshotCountFor({ snapshotRing: [makeSnapshot('javascript')] }, undefined),
      ).toBe(0);
    });
  });

  describe('hasScopeSnapshotFor', () => {
    it('is true when the scope language matches and the tab is not in Node mode', () => {
      const state = { scopeSnapshot: makeScope('javascript', 3) };
      expect(hasScopeSnapshotFor(state, 'javascript', 'worker')).toBe(true);
      expect(hasScopeSnapshotFor(state, 'javascript', undefined)).toBe(true);
    });

    it('is false in Node runtime, on language mismatch, or with no snapshot', () => {
      const state = { scopeSnapshot: makeScope('javascript', 3) };
      expect(hasScopeSnapshotFor(state, 'javascript', 'node')).toBe(false);
      expect(hasScopeSnapshotFor(state, 'python', 'worker')).toBe(false);
      expect(hasScopeSnapshotFor({ scopeSnapshot: null }, 'javascript', 'worker')).toBe(false);
      expect(hasScopeSnapshotFor(state, undefined, 'worker')).toBe(false);
    });
  });

  describe('scopeSnapshotVariableCountFor', () => {
    it('returns the variable count for a matching snapshot', () => {
      expect(
        scopeSnapshotVariableCountFor({ scopeSnapshot: makeScope('javascript', 4) }, 'javascript'),
      ).toBe(4);
    });

    it('returns null (not 0) when there is no matching snapshot', () => {
      expect(scopeSnapshotVariableCountFor({ scopeSnapshot: null }, 'javascript')).toBeNull();
      expect(
        scopeSnapshotVariableCountFor({ scopeSnapshot: makeScope('python', 2) }, 'javascript'),
      ).toBeNull();
      expect(
        scopeSnapshotVariableCountFor({ scopeSnapshot: makeScope('javascript', 2) }, undefined),
      ).toBeNull();
    });

    it('returns 0 (not null) for a matching snapshot with zero variables', () => {
      expect(
        scopeSnapshotVariableCountFor({ scopeSnapshot: makeScope('javascript', 0) }, 'javascript'),
      ).toBe(0);
    });
  });

  describe('render-count regression (implementation note)', () => {
    const initialState = useResultStore.getState();

    beforeEach(() => {
      useResultStore.setState(initialState, true);
    });

    afterEach(() => {
      useResultStore.setState(initialState, true);
    });

    it('does not re-render a comparator subscriber when the count is unchanged', () => {
      let renders = 0;
      function Probe() {
        renders += 1;
        const count = useResultStore((s) => comparableSnapshotCountFor(s, 'javascript'));
        return createElement('span', { 'data-testid': 'count' }, count);
      }

      act(() => {
        useResultStore.setState({ snapshotRing: [makeSnapshot('javascript')] });
      });
      render(createElement(Probe));
      expect(renders).toBe(1);

      // New snapshotRing reference, SAME javascript count → no re-render.
      act(() => {
        useResultStore.setState({
          snapshotRing: [makeSnapshot('javascript'), makeSnapshot('python')],
        });
      });
      expect(renders).toBe(1);

      // Count actually changes (2 javascript snapshots) → exactly one re-render.
      act(() => {
        useResultStore.setState({
          snapshotRing: [makeSnapshot('javascript'), makeSnapshot('javascript')],
        });
      });
      expect(renders).toBe(2);
    });

    it('does not re-render a scope subscriber when the variable count is unchanged', () => {
      let renders = 0;
      function Probe() {
        renders += 1;
        const count = useResultStore((s) => scopeSnapshotVariableCountFor(s, 'javascript'));
        return createElement('span', { 'data-testid': 'scope' }, String(count));
      }

      act(() => {
        useResultStore.setState({ scopeSnapshot: makeScope('javascript', 2) });
      });
      render(createElement(Probe));
      expect(renders).toBe(1);

      // New scopeSnapshot reference, same variable count → no re-render.
      act(() => {
        useResultStore.setState({ scopeSnapshot: makeScope('javascript', 2) });
      });
      expect(renders).toBe(1);

      // Variable count changes → exactly one re-render.
      act(() => {
        useResultStore.setState({ scopeSnapshot: makeScope('javascript', 5) });
      });
      expect(renders).toBe(2);
    });
  });
});
