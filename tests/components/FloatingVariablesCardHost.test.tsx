import { Profiler, StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingVariablesCardHost } from '@/components/Editor/FloatingVariablesCardHost';
import type { FloatingVariablesCardProps } from '@/components/Editor/FloatingVariablesCard';
import { initI18n } from '@/i18n';
import { useEditorStore } from '@/stores/editorStore';
import { useResultStore } from '@/stores/resultStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { FileTab } from '@/types';

const mocks = vi.hoisted(() => ({
  loadCard: vi.fn(),
}));

vi.mock('@/components/Editor/floatingVariablesCardLoader', () => ({
  loadFloatingVariablesCard: mocks.loadCard,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function CardProbe({ activeTabId, scopeSnapshot }: FloatingVariablesCardProps) {
  return (
    <div data-testid="floating-variables-card-probe">
      {activeTabId}:{scopeSnapshot.capturedAt}
    </div>
  );
}

function patchActiveTab(patch: Partial<FileTab>) {
  const activeTab = useEditorStore.getState().tabs[0];
  if (!activeTab) throw new Error('missing active tab fixture');
  useEditorStore.setState({ tabs: [{ ...activeTab, ...patch }] });
}

describe('FloatingVariablesCardHost', () => {
  beforeEach(() => {
    initI18n('en');
    mocks.loadCard.mockReset();
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js',
          name: 'main.js',
          language: 'javascript',
          content: 'const answer = 42;',
          isDirty: false,
          variableInspectorEnabled: true,
          runtimeMode: 'worker',
        },
      ],
      activeTabId: 'tab-js',
    });
    useResultStore.setState({
      scopeSnapshot: {
        language: 'javascript',
        capturedAt: 100,
        variables: [],
      },
    });
    useSettingsStore.setState({ variableInspectorSurface: 'floating' });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows immediate feedback and renders the loaded card with current state', async () => {
    const pending = deferred<{ FloatingVariablesCard: typeof CardProbe }>();
    mocks.loadCard.mockReturnValue(pending.promise);

    render(
      <StrictMode>
        <FloatingVariablesCardHost />
      </StrictMode>
    );

    expect(screen.getByTestId('floating-variables-card-loading').textContent).toContain(
      'Loading variables'
    );

    act(() => {
      useResultStore.setState({
        scopeSnapshot: {
          language: 'javascript',
          capturedAt: 101,
          variables: [],
        },
      });
    });
    await act(async () => {
      pending.resolve({ FloatingVariablesCard: CardProbe });
    });

    expect((await screen.findByTestId('floating-variables-card-probe')).textContent).toBe(
      'tab-js:101'
    );
  });

  it.each([
    {
      name: 'the inspector is disabled',
      configure: () => patchActiveTab({ variableInspectorEnabled: false }),
    },
    {
      name: 'the active runtime is Node',
      configure: () => patchActiveTab({ runtimeMode: 'node' }),
    },
    {
      name: 'the active language is unsupported',
      configure: () => patchActiveTab({ language: 'go' }),
    },
    {
      name: 'the scope snapshot belongs to another language',
      configure: () =>
        useResultStore.setState({
          scopeSnapshot: { language: 'python', capturedAt: 100, variables: [] },
        }),
    },
    {
      name: 'the selected surface is the bottom panel',
      configure: () => useSettingsStore.setState({ variableInspectorSurface: 'bottom' }),
    },
  ])('does not request the card when $name', ({ configure }) => {
    configure();
    render(<FloatingVariablesCardHost />);

    expect(mocks.loadCard).not.toHaveBeenCalled();
    expect(screen.queryByTestId('floating-variables-card-loading')).toBeNull();
  });

  it('ignores editor keystrokes while reacting to eligibility changes', () => {
    const pending = deferred<{ FloatingVariablesCard: typeof CardProbe }>();
    mocks.loadCard.mockReturnValue(pending.promise);
    let commits = 0;

    render(
      <Profiler
        id="floating-variables-card-host"
        onRender={() => {
          commits += 1;
        }}
      >
        <FloatingVariablesCardHost />
      </Profiler>
    );
    expect(screen.getByTestId('floating-variables-card-loading')).toBeTruthy();
    const commitsAfterMount = commits;

    act(() => {
      useEditorStore.getState().updateContent('tab-js', 'const answer = 43;');
      useEditorStore.getState().updateContent('tab-js', 'const answer = 44;');
    });
    expect(commits).toBe(commitsAfterMount);

    act(() => {
      useEditorStore.getState().setTabVariableInspectorEnabled('tab-js', false);
    });
    expect(commits).toBeGreaterThan(commitsAfterMount);
    expect(screen.queryByTestId('floating-variables-card-loading')).toBeNull();
  });

  it('surfaces a localized failure with an honest reload action', async () => {
    const error = new Error('floating Variables chunk unavailable');
    mocks.loadCard.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<FloatingVariablesCardHost />);

    expect(
      (await screen.findByTestId('floating-variables-card-load-failed')).textContent
    ).toContain('Variables could not load');
    expect(consoleError).toHaveBeenCalledWith(
      '[variable-inspector] failed to load the floating Variables card',
      error
    );
    expect(screen.getByRole('button', { name: 'Reload Lingua' })).toBeTruthy();
    expect(mocks.loadCard).toHaveBeenCalledTimes(1);
  });

  it('ignores a late module result after the surface deactivates', async () => {
    const pending = deferred<{ FloatingVariablesCard: typeof CardProbe }>();
    mocks.loadCard.mockReturnValue(pending.promise);
    render(<FloatingVariablesCardHost />);

    act(() => {
      useSettingsStore.setState({ variableInspectorSurface: 'bottom' });
    });
    await act(async () => {
      pending.resolve({ FloatingVariablesCard: CardProbe });
    });

    expect(screen.queryByTestId('floating-variables-card-probe')).toBeNull();
  });
});
