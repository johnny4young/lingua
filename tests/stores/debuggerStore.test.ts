import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEBUGGER_STORAGE_KEY,
  MAX_BREAKPOINTS_GLOBAL,
  MAX_WATCHES,
  useDebuggerStore,
} from '@/stores/debuggerStore';

beforeEach(() => {
  useDebuggerStore.setState(
    {
      breakpoints: {},
      breakpointOrder: [],
      watches: [],
      session: null,
      pausedFrame: null,
    },
    false
  );
  localStorage.removeItem(DEBUGGER_STORAGE_KEY);
});

afterEach(() => {
  localStorage.removeItem(DEBUGGER_STORAGE_KEY);
});

describe('debuggerStore (RL-027 Slice 1)', () => {
  it('toggleBreakpoint adds and removes idempotently', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 5);
    expect(Object.keys(useDebuggerStore.getState().breakpoints)).toHaveLength(1);

    useDebuggerStore.getState().toggleBreakpoint('tab-1', 5);
    expect(useDebuggerStore.getState().breakpoints).toEqual({});
  });

  it('ignores invalid breakpoint identities', () => {
    useDebuggerStore.getState().toggleBreakpoint('', 1);
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 0);
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 1.5);
    expect(useDebuggerStore.getState().breakpoints).toEqual({});
  });

  it('breakpointsForTab returns only the tab\'s breakpoints', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 5);
    useDebuggerStore.getState().toggleBreakpoint('tab-2', 7);
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 9);

    const tab1 = useDebuggerStore.getState().breakpointsForTab('tab-1');
    expect(tab1.map((bp) => bp.line).sort()).toEqual([5, 9]);
    const tab2 = useDebuggerStore.getState().breakpointsForTab('tab-2');
    expect(tab2.map((bp) => bp.line)).toEqual([7]);
  });

  it('FIFO-evicts oldest breakpoint when MAX_BREAKPOINTS_GLOBAL is reached', () => {
    for (let i = 1; i <= MAX_BREAKPOINTS_GLOBAL + 3; i += 1) {
      useDebuggerStore.getState().toggleBreakpoint('tab-1', i);
    }
    const state = useDebuggerStore.getState();
    expect(Object.keys(state.breakpoints)).toHaveLength(MAX_BREAKPOINTS_GLOBAL);
    // Oldest 3 lines (1, 2, 3) should have been evicted.
    expect(state.breakpoints['tab-1:1']).toBeUndefined();
    expect(state.breakpoints['tab-1:2']).toBeUndefined();
    expect(state.breakpoints['tab-1:3']).toBeUndefined();
    expect(state.breakpoints[`tab-1:${MAX_BREAKPOINTS_GLOBAL + 3}`]).toBeDefined();
  });

  it('setBreakpointCondition stores the predicate string', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 5);
    useDebuggerStore.getState().setBreakpointCondition('tab-1', 5, 'x > 0');
    expect(useDebuggerStore.getState().breakpoints['tab-1:5']?.condition).toBe('x > 0');
  });

  it('setBreakpointEnabled flips the active flag without removing the bp', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 5);
    useDebuggerStore.getState().setBreakpointEnabled('tab-1', 5, false);
    expect(useDebuggerStore.getState().breakpoints['tab-1:5']?.enabled).toBe(false);
  });

  it('clearAllBreakpoints wipes both map and order', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 5);
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 7);
    useDebuggerStore.getState().clearAllBreakpoints();
    const state = useDebuggerStore.getState();
    expect(state.breakpoints).toEqual({});
    expect(state.breakpointOrder).toEqual([]);
  });

  it('addWatch dedupes by trimmed expression and respects MAX_WATCHES', () => {
    useDebuggerStore.getState().addWatch('x + 1');
    useDebuggerStore.getState().addWatch('  x + 1  ');
    expect(useDebuggerStore.getState().watches).toHaveLength(1);

    for (let i = 0; i < MAX_WATCHES + 3; i += 1) {
      useDebuggerStore.getState().addWatch(`expr-${i}`);
    }
    expect(useDebuggerStore.getState().watches.length).toBeLessThanOrEqual(MAX_WATCHES);
  });

  it('attachSession + detachSession transition the session field', () => {
    const session = { runtime: 'js' as const, tabId: 'tab-1', attachedAt: 1 };
    useDebuggerStore.getState().attachSession(session);
    expect(useDebuggerStore.getState().session).toEqual(session);
    useDebuggerStore.getState().detachSession();
    expect(useDebuggerStore.getState().session).toBeNull();
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();
  });

  it('persists breakpoints + watches but not the session/pausedFrame', async () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 5);
    useDebuggerStore.getState().addWatch('x + 1');
    useDebuggerStore.getState().attachSession({
      runtime: 'js',
      tabId: 'tab-1',
      attachedAt: 1,
    });

    await Promise.resolve();
    const raw = localStorage.getItem(DEBUGGER_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      state: { breakpoints: object; watches: unknown[]; session?: unknown };
    };
    expect(Object.keys(parsed.state.breakpoints)).toHaveLength(1);
    expect(parsed.state.watches).toHaveLength(1);
    expect(parsed.state.session).toBeUndefined();
  });

  it('sanitizes persisted breakpoints and watches during rehydration', async () => {
    const tooManyWatches = Array.from({ length: MAX_WATCHES + 5 }, (_value, index) => ({
      id: `watch-${index}`,
      expression: ` value${index} `,
    }));
    localStorage.setItem(
      DEBUGGER_STORAGE_KEY,
      JSON.stringify({
        state: {
          breakpoints: {
            good: { tabId: 'tab-1', line: 2, condition: 42, enabled: true },
            disabled: { tabId: 'tab-1', line: 3, condition: 'x > 0', enabled: false },
            badLine: { tabId: 'tab-1', line: -1 },
            badTab: { tabId: '', line: 4 },
          },
          breakpointOrder: ['tab-1:3', 'missing', 'tab-1:2'],
          watches: [
            ...tooManyWatches,
            { id: 'duplicate', expression: 'value1' },
            { id: '', expression: 'nope' },
          ],
          session: { runtime: 'js', tabId: 'stale', attachedAt: 1 },
          pausedFrame: { tabId: 'stale', line: 1 },
        },
        version: 0,
      })
    );

    await (
      useDebuggerStore as typeof useDebuggerStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    const state = useDebuggerStore.getState();
    expect(Object.keys(state.breakpoints).sort()).toEqual(['tab-1:2', 'tab-1:3']);
    expect(state.breakpoints['tab-1:2']).toMatchObject({
      tabId: 'tab-1',
      line: 2,
      condition: '',
      enabled: true,
    });
    expect(state.breakpoints['tab-1:3']?.enabled).toBe(false);
    expect(state.breakpointOrder).toEqual(['tab-1:3', 'tab-1:2']);
    expect(state.watches).toHaveLength(MAX_WATCHES);
    expect(state.watches[0]).toEqual({ id: 'watch-0', expression: 'value0' });
    expect(state.session).toBeNull();
    expect(state.pausedFrame).toBeNull();
  });
});
