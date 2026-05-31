/**
 * RL-121 — coverage for the centralized active-tab access seam:
 * `getActiveTab` / `getActiveTabIndex` selectors on `editorStore` and
 * the `useActiveTab` / `useActiveTabId` React hooks.
 *
 * The load-bearing guarantee is REFERENTIAL STABILITY: a subscriber
 * reading the active tab through `useActiveTab()` must NOT re-render
 * when an unrelated tab mutates. That invariant is what removes the
 * O(N·M) re-render fan-out the audit (AUDIT-01 / §3.1) flagged, where
 * ~15 components each re-derived the active tab inline and re-rendered
 * on every `tabs` array change.
 */

import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useActiveTab, useActiveTabId } from '@/hooks/useActiveTab';
import {
  getActiveTab,
  getActiveTabIndex,
  useEditorStore,
} from '@/stores/editorStore';
import type { FileTab } from '@/types';

function makeTab(id: string, overrides: Partial<FileTab> = {}): FileTab {
  return {
    id,
    name: `${id}.js`,
    language: 'javascript',
    content: '',
    isDirty: false,
    ...overrides,
  };
}

function seed(tabs: FileTab[], activeTabId: string | null): void {
  useEditorStore.setState({ tabs, activeTabId });
}

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

describe('getActiveTab selector', () => {
  it('returns null when there are no tabs', () => {
    expect(getActiveTab(useEditorStore.getState())).toBeNull();
  });

  it('returns null when activeTabId is null', () => {
    seed([makeTab('a')], null);
    expect(getActiveTab(useEditorStore.getState())).toBeNull();
  });

  it('returns null when activeTabId points at a removed tab', () => {
    seed([makeTab('a')], 'ghost');
    expect(getActiveTab(useEditorStore.getState())).toBeNull();
  });

  it('returns the active tab object by id', () => {
    const a = makeTab('a');
    const b = makeTab('b');
    seed([a, b], 'b');
    expect(getActiveTab(useEditorStore.getState())).toBe(b);
  });

  it('returns the EXISTING tab object reference (never allocates)', () => {
    const a = makeTab('a');
    seed([a], 'a');
    // The selector must hand back the same object held in state.tabs,
    // not a copy — referential stability depends on it.
    expect(getActiveTab(useEditorStore.getState())).toBe(a);
  });
});

describe('getActiveTabIndex selector', () => {
  it('returns -1 when there is no active tab', () => {
    seed([makeTab('a')], null);
    expect(getActiveTabIndex(useEditorStore.getState())).toBe(-1);
  });

  it('returns the index of the active tab', () => {
    seed([makeTab('a'), makeTab('b'), makeTab('c')], 'c');
    expect(getActiveTabIndex(useEditorStore.getState())).toBe(2);
  });
});

describe('useActiveTab hook', () => {
  it('returns null when no tab is active', () => {
    const { result } = renderHook(() => useActiveTab());
    expect(result.current).toBeNull();
  });

  it('returns the active tab and updates on selection change', () => {
    seed([makeTab('a'), makeTab('b')], 'a');
    const { result } = renderHook(() => useActiveTab());
    expect(result.current?.id).toBe('a');
    act(() => {
      useEditorStore.setState({ activeTabId: 'b' });
    });
    expect(result.current?.id).toBe('b');
  });

  it('returns null after the active tab is removed', () => {
    seed([makeTab('a')], 'a');
    const { result } = renderHook(() => useActiveTab());
    expect(result.current?.id).toBe('a');
    act(() => {
      useEditorStore.setState({ tabs: [], activeTabId: null });
    });
    expect(result.current).toBeNull();
  });

  it('does NOT re-render when an UNRELATED tab mutates (fold C)', () => {
    const active = makeTab('active');
    seed([active, makeTab('other')], 'active');

    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useActiveTab();
    });
    const baseline = renders;

    // Mutate the OTHER tab only; keep the active tab's object identity.
    act(() => {
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === 'other' ? { ...tab, content: 'changed' } : tab
        ),
      }));
    });

    // useShallow short-circuits because getActiveTab returns a
    // shallow-equal active tab → no re-render.
    expect(renders).toBe(baseline);
  });

  it('re-renders when the active tab itself changes content', () => {
    seed([makeTab('active'), makeTab('other')], 'active');
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useActiveTab();
    });
    const baseline = renders;
    act(() => {
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === 'active' ? { ...tab, content: 'edited' } : tab
        ),
      }));
    });
    expect(renders).toBeGreaterThan(baseline);
    expect(result.current?.content).toBe('edited');
  });
});

describe('useActiveTabId hook (fold A)', () => {
  it('tracks the active tab id without subscribing to tab content', () => {
    seed([makeTab('a'), makeTab('b')], 'a');
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useActiveTabId();
    });
    expect(result.current).toBe('a');
    const baseline = renders;

    // Editing the active tab's CONTENT must not re-render an id-only
    // subscriber — the id is unchanged.
    act(() => {
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === 'a' ? { ...tab, content: 'x' } : tab
        ),
      }));
    });
    expect(renders).toBe(baseline);

    act(() => {
      useEditorStore.setState({ activeTabId: 'b' });
    });
    expect(result.current).toBe('b');
  });
});
