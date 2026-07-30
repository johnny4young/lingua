/**
 * internal polish #7 — smoke tests for FloatingVariablesCard.
 *
 * Eligibility and lazy loading belong to FloatingVariablesCardHost. These
 * tests exercise the loaded implementation: value rendering, scroll reach,
 * and the close action that clears the per-tab inspector flag.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { FloatingVariablesCard } from '@/components/Editor/FloatingVariablesCard';
import { useEditorStore } from '@/stores/editorStore';
import { useResultStore } from '@/stores/resultStore';
import { useUIStore } from '@/stores/uiStore';

const setTabVariableInspectorEnabledMock = vi.fn();

beforeEach(async () => {
  await initI18n();
  setTabVariableInspectorEnabledMock.mockClear();
  useEditorStore.setState({
    tabs: [
      {
        id: 'tab-ts',
        name: 'main.ts',
        language: 'typescript',
        content: 'const x = 1',
        isDirty: false,
        variableInspectorEnabled: true,
      },
    ],
    activeTabId: 'tab-ts',
    pendingReveal: null,
    setTabVariableInspectorEnabled: setTabVariableInspectorEnabledMock,
  });
  useResultStore.setState({
    scopeSnapshot: {
      language: 'typescript',
      capturedAt: 100,
      variables: [
        {
          name: 'value',
          value: { kind: 'primitive', type: 'number', repr: '42' },
        },
      ],
    },
  });
  useUIStore.setState({
    variablesCardPosition: null,
    variablesCardCollapsed: false,
  });
});

function renderCard() {
  const activeTab = useEditorStore.getState().tabs[0];
  const scopeSnapshot = useResultStore.getState().scopeSnapshot;
  if (!activeTab || !scopeSnapshot) {
    throw new Error('missing floating Variables fixture');
  }
  return render(
    <I18nextProvider i18n={i18next}>
      <FloatingVariablesCard activeTabId={activeTab.id} scopeSnapshot={scopeSnapshot} />
    </I18nextProvider>
  );
}

describe('FloatingVariablesCard', () => {
  it('renders the card with variables when the four gates pass', () => {
    renderCard();
    expect(screen.getByTestId('floating-variables-card')).toBeTruthy();
    expect(screen.getByText('value')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('keeps every captured variable reachable inside a scrollable body', () => {
    useResultStore.setState({
      scopeSnapshot: {
        language: 'typescript',
        capturedAt: 101,
        variables: Array.from({ length: 8 }, (_, index) => ({
          name: `value${index + 1}`,
          value: {
            kind: 'primitive',
            type: 'number',
            repr: `${index + 1}`,
          },
        })),
      },
    });

    renderCard();

    expect(screen.getByText('value1')).toBeTruthy();
    expect(screen.getByText('value8')).toBeTruthy();
    expect(document.body.querySelector('.floating-variables-card-body')).toBeTruthy();
    expect(screen.queryByText(/more hidden|más ocultas/i)).toBeNull();
  });

  it('flips variableInspectorEnabled off when the close button fires', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByLabelText(/close|cerrar/i));
    expect(setTabVariableInspectorEnabledMock).toHaveBeenCalledWith('tab-ts', false);
  });
});
