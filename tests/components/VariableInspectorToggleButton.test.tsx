/**
 * RL-020 Slice 9 — VariableInspectorToggleButton render contract.
 *
 * Covers:
 *   - Disabled when no scope snapshot for the active language.
 *   - Disabled when the snapshot's language differs.
 *   - Enabled-off when snapshot matches; click fires telemetry +
 *     flips the per-tab flag.
 *   - Pressed-state mirrors `variableInspectorEnabled`.
 *   - Disabled clicks are no-ops.
 */

import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VariableInspectorToggleButton } from '../../src/renderer/components/Editor/VariableInspectorToggleButton';
import { useResultStore } from '../../src/renderer/stores/resultStore';

const trackEventMock = vi.fn();
const setTabVariableInspectorEnabledMock = vi.fn();

interface MockTab {
  id: string;
  language: string;
  variableInspectorEnabled?: boolean;
}

const editorState: {
  tabs: MockTab[];
  activeTabId: string | null;
  setTabVariableInspectorEnabled: typeof setTabVariableInspectorEnabledMock;
} = {
  tabs: [],
  activeTabId: null,
  setTabVariableInspectorEnabled: setTabVariableInspectorEnabledMock,
};

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (selector?: (state: unknown) => unknown) =>
    selector ? selector(editorState) : editorState,
}));

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function setActiveTab(tab: MockTab | null): void {
  if (tab === null) {
    editorState.tabs = [];
    editorState.activeTabId = null;
    return;
  }
  editorState.tabs = [tab];
  editorState.activeTabId = tab.id;
}

function setScopeSnapshot(language: string, variableCount = 1): void {
  const variables = Array.from({ length: variableCount }, (_, index) => ({
    name: `v${index}`,
    value: {
      kind: 'primitive' as const,
      type: 'number' as const,
      repr: String(index),
    },
  }));
  useResultStore.setState({
    scopeSnapshot: {
      language,
      capturedAt: 100,
      variables,
    },
  });
}

describe('RL-020 Slice 9 — <VariableInspectorToggleButton>', () => {
  beforeEach(() => {
    trackEventMock.mockReset();
    setTabVariableInspectorEnabledMock.mockReset();
    setActiveTab({ id: 'tab-1', language: 'javascript' });
    useResultStore.setState({ scopeSnapshot: null });
  });

  it('renders disabled when no scope snapshot is available', () => {
    const { container } = render(<VariableInspectorToggleButton />);
    const button = container.querySelector('[data-testid="variable-inspector-toggle"]');
    expect(button?.getAttribute('disabled')).toBe('');
    expect(button?.getAttribute('data-state')).toBe('disabled');
  });

  it('renders disabled when the snapshot language differs', () => {
    setScopeSnapshot('python');
    const { container } = render(<VariableInspectorToggleButton />);
    expect(
      container
        .querySelector('[data-testid="variable-inspector-toggle"]')
        ?.getAttribute('data-state')
    ).toBe('disabled');
  });

  it('renders enabled-off when snapshot matches', () => {
    setScopeSnapshot('javascript');
    const { container } = render(<VariableInspectorToggleButton />);
    const button = container.querySelector('[data-testid="variable-inspector-toggle"]');
    expect(button?.getAttribute('disabled')).toBeNull();
    expect(button?.getAttribute('data-state')).toBe('off');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
  });

  it('flips per-tab flag and fires telemetry on click', () => {
    setScopeSnapshot('javascript', 6);
    const { container } = render(<VariableInspectorToggleButton />);
    const button = container.querySelector('[data-testid="variable-inspector-toggle"]');
    if (!button) throw new Error('button not rendered');
    fireEvent.click(button);
    expect(setTabVariableInspectorEnabledMock).toHaveBeenCalledWith(
      'tab-1',
      true
    );
    expect(trackEventMock).toHaveBeenCalledWith(
      'runtime.variable_inspector_opened',
      { language: 'javascript', variableCount: '6-20' }
    );
  });

  it('renders the on state with aria-pressed when the flag is set', () => {
    setActiveTab({
      id: 'tab-1',
      language: 'javascript',
      variableInspectorEnabled: true,
    });
    setScopeSnapshot('javascript');
    const { container } = render(<VariableInspectorToggleButton />);
    const button = container.querySelector('[data-testid="variable-inspector-toggle"]');
    expect(button?.getAttribute('data-state')).toBe('on');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });

  it('does nothing when clicked while disabled', () => {
    const { container } = render(<VariableInspectorToggleButton />);
    const button = container.querySelector('[data-testid="variable-inspector-toggle"]');
    if (!button) throw new Error('button not rendered');
    fireEvent.click(button);
    expect(setTabVariableInspectorEnabledMock).not.toHaveBeenCalled();
    expect(trackEventMock).not.toHaveBeenCalled();
  });
});
