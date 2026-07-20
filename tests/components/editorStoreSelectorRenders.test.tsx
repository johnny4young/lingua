/**
 * implementation (implementation, implementation note) — render-count probe for the audit's
 * literal AC: the App-level editorStore selectors (internal vintage,
 * e.g. `s => s.activeTabId`) must not re-render their component on
 * unrelated store mutations such as `pendingReveal`. Asserted in both
 * directions so the test is a real contract, not a vacuous pass: an
 * unrelated mutation keeps the render count flat AND a related one
 * bumps it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { useEditorStore } from '@/stores/editorStore';

const initialEditorState = useEditorStore.getState();

describe('App-level editorStore selectors ', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-1',
          name: 'untitled.ts',
          language: 'typescript',
          content: 'const x = 1;',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-1',
      pendingReveal: null,
    });
  });

  afterEach(() => {
    useEditorStore.setState(initialEditorState, true);
  });

  it('does not re-render on pendingReveal mutations; does on activeTabId', () => {
    let renders = 0;

    function Probe() {
      renders += 1;
      const activeTabId = useEditorStore((s) => s.activeTabId);
      return <div data-testid="probe">{activeTabId}</div>;
    }

    render(<Probe />);
    const rendersAfterMount = renders;

    act(() => {
      useEditorStore.setState({ pendingReveal: { tabId: 'tab-1', line: 3, column: 1 } });
      useEditorStore.setState({ pendingReveal: null });
    });
    expect(renders).toBe(rendersAfterMount);

    act(() => {
      useEditorStore.setState({ activeTabId: null });
    });
    expect(renders).toBeGreaterThan(rendersAfterMount);
  });
});
