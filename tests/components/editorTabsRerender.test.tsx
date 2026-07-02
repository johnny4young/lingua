/**
 * Roadmap T4 — per-tab render isolation.
 *
 * `updateContent` mints a new `tabs` array on every keystroke, so the
 * `EditorTabs` strip re-renders. Before the memoized `EditorTabItem`
 * split, that re-rendered EVERY row's subtree (glyph, filename,
 * GitStatusPill, status control) even though only the active tab's
 * content changed. This probe locks the contract: editing one tab's
 * content re-renders ONLY that tab's row, never its siblings.
 *
 * The probe counts GitStatusPill renders per file path (one pill per
 * row); the real store drives the mutation so this is an end-to-end
 * assertion of the memo boundary, not a shallow-render trick.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

// Stable `t` reference — i18next memoizes `t` across renders unless the
// language changes, so a fresh closure per call would misrepresent
// reality AND break the memo under test (a new `t` prop each parent
// render). Mirror the real stability.
const t = (key: string, opts?: Record<string, unknown>) =>
  opts && opts.name !== undefined ? `${key}:${String(opts.name)}` : key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } }),
}));

// Count GitStatusPill renders keyed by file path — one pill per row, so
// the counter is a faithful proxy for "did this row's subtree re-render".
const pillRenders: Record<string, number> = {};
vi.mock('@/components/Editor/GitStatusPill', () => ({
  GitStatusPill: ({ filePath }: { filePath: string }) => {
    pillRenders[filePath] = (pillRenders[filePath] ?? 0) + 1;
    return <span data-testid={`git-pill-${filePath}`} />;
  },
}));

import { EditorTabs } from '@/components/Editor/EditorTabs';
import { useEditorStore } from '@/stores/editorStore';

const initialEditorState = useEditorStore.getState();

const TAB_A = {
  id: 'tab-a',
  name: 'a.ts',
  language: 'typescript' as const,
  content: 'const a = 1;',
  isDirty: false,
  filePath: '/repo/a.ts',
};
const TAB_B = {
  id: 'tab-b',
  name: 'b.ts',
  language: 'typescript' as const,
  content: 'const b = 2;',
  isDirty: false,
  filePath: '/repo/b.ts',
};

describe('EditorTabs — per-tab render isolation (roadmap T4)', () => {
  beforeEach(() => {
    for (const key of Object.keys(pillRenders)) delete pillRenders[key];
    useEditorStore.setState(
      { tabs: [structuredClone(TAB_A), structuredClone(TAB_B)], activeTabId: 'tab-a' },
      false
    );
  });

  afterEach(() => {
    useEditorStore.setState(initialEditorState, true);
  });

  it('editing one tab does not re-render sibling tab rows', () => {
    render(<EditorTabs />);

    const baselineA = pillRenders['/repo/a.ts'] ?? 0;
    const baselineB = pillRenders['/repo/b.ts'] ?? 0;
    expect(baselineA).toBeGreaterThan(0);
    expect(baselineB).toBeGreaterThan(0);

    // Edit ONLY tab-a's content through the real store.
    act(() => {
      useEditorStore.getState().updateContent('tab-a', 'const a = 42;');
    });

    // The edited row re-rendered; the sibling row did not.
    expect(pillRenders['/repo/a.ts']).toBeGreaterThan(baselineA);
    expect(pillRenders['/repo/b.ts']).toBe(baselineB);
  });

  it('switching the active tab re-renders only the two affected rows', () => {
    render(<EditorTabs />);
    const baselineA = pillRenders['/repo/a.ts'] ?? 0;
    const baselineB = pillRenders['/repo/b.ts'] ?? 0;

    act(() => {
      useEditorStore.getState().setActiveTab('tab-b');
    });

    // Both rows flip their active flag, so both are expected to update —
    // this is the counter-assertion that the memo is not simply frozen.
    expect(pillRenders['/repo/a.ts']).toBeGreaterThan(baselineA);
    expect(pillRenders['/repo/b.ts']).toBeGreaterThan(baselineB);
  });
});
