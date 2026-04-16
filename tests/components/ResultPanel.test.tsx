import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultPanel } from '../../src/renderer/components/Editor/ResultPanel';
import { useResultStore } from '../../src/renderer/stores/resultStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      tabs: [
        {
          id: 'tab-ts',
          name: 'main.ts',
          language: 'typescript',
          content: 'console.log("hello")\nvalue',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-ts',
    };

    return selector ? selector(state) : state;
  },
}));

describe('ResultPanel', () => {
  const initialResultState = useResultStore.getState();
  const initialSettingsState = useSettingsStore.getState();

  beforeEach(() => {
    useResultStore.setState(initialResultState, true);
    useSettingsStore.setState(initialSettingsState, true);
  });

  it('does not show the undefined toggle when there is no undefined result to filter', () => {
    useResultStore.setState({
      lineResults: [{ line: 1, value: 'hello', type: 'log' }],
      error: null,
      fullOutput: '',
      executionTime: 12,
      isAutoRunning: false,
      executionSource: 'auto',
    });

    render(<ResultPanel />);

    expect(screen.queryByRole('button', { name: 'undefined' })).toBeNull();
  });

  it('lets users reveal undefined expression results on demand', async () => {
    const user = userEvent.setup();

    useResultStore.setState({
      lineResults: [{ line: 2, value: 'undefined', type: 'result' }],
      error: null,
      fullOutput: '',
      executionTime: 3,
      isAutoRunning: false,
      executionSource: 'auto',
    });
    useSettingsStore.setState({ hideUndefined: true });

    render(<ResultPanel />);

    expect(screen.getByTitle('Show undefined values')).toBeTruthy();
    expect(screen.getAllByText('undefined')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'undefined' }));

    expect(screen.getByTitle('Hide undefined values')).toBeTruthy();
    expect(screen.getAllByText('undefined')).toHaveLength(2);
  });
});
