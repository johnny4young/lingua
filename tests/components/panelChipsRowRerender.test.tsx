/**
 * internal — render-count probe for the PanelChipsRow subscription
 * contract: the chips row reads only PRIMITIVE derivations of the active
 * tab (id / language / runtimeMode / stdin line count / per-tab toggle
 * flags), so an editor keystroke (`updateContent` mints a new `tabs`
 * array with a new active-tab object whose `content` changed) must NOT
 * re-render the row. Asserted in both directions so the test is a real
 * contract, not a vacuous pass: a content edit keeps the commit count
 * flat AND a chip-relevant mutation (the per-tab compare flag) bumps it.
 *
 * The probe wraps the row in a React `<Profiler>` — the subtree contains
 * only the row, so commits map 1:1 to row re-renders. The real store
 * drives the mutations, mirroring `tests/components/editorTabsRerender`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Profiler } from 'react';
import { act, render, screen } from '@testing-library/react';
import { PanelChipsRow } from '@/components/Layout/PanelChipsRow';
import { useEditorStore } from '@/stores/editorStore';

const initialEditorState = useEditorStore.getState();

describe('PanelChipsRow subscription contract', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-1',
          name: 'untitled.js',
          language: 'javascript',
          content: 'const x = 1;',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-1',
    });
  });

  afterEach(() => {
    useEditorStore.setState(initialEditorState, true);
  });

  it('ignores content keystrokes; reacts to a chip-relevant tab mutation', () => {
    let commits = 0;

    render(
      <Profiler
        id="panel-chips-row"
        onRender={() => {
          commits += 1;
        }}
      >
        <PanelChipsRow />
      </Profiler>
    );
    expect(screen.getByTestId('panel-chip-stdin')).toBeTruthy();
    const commitsAfterMount = commits;

    // Keystroke path: updateContent replaces the tabs array AND the
    // active-tab object, but every primitive the row subscribes to is
    // unchanged — the row must not commit.
    act(() => {
      useEditorStore.getState().updateContent('tab-1', 'const x = 2;');
      useEditorStore.getState().updateContent('tab-1', 'const x = 3;');
    });
    expect(commits).toBe(commitsAfterMount);

    // Chip-relevant path: the compare flag feeds the compare chip's
    // `active` state, so flipping it must commit.
    act(() => {
      useEditorStore.getState().setTabCompareEnabled('tab-1', true);
    });
    expect(commits).toBeGreaterThan(commitsAfterMount);
  });

  it('renders nothing without an active tab', () => {
    act(() => {
      useEditorStore.setState({ activeTabId: null });
    });
    render(<PanelChipsRow />);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});
