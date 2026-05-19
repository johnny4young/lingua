/**
 * RL-093 polish #7 — smoke tests for FloatingVariablesCard.
 *
 * The card is gated by FOUR conditions in series:
 *   - active tab has `variableInspectorEnabled === true`
 *   - active tab is NOT in Node runtime (RL-019 exclusion)
 *   - active tab's language is JS / TS / Python
 *   - the result store carries a snapshot whose `language` matches
 *
 * These tests verify (1) all four gates → renders, (2) flipping the
 * runtime to `node` hides it, and (3) the close button calls back into
 * the editor store to flip `variableInspectorEnabled` off.
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
  return render(
    <I18nextProvider i18n={i18next}>
      <FloatingVariablesCard />
    </I18nextProvider>,
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

  it('does not render when the active tab uses the Node runtime', () => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-ts',
          name: 'main.ts',
          language: 'typescript',
          content: 'const x = 1',
          isDirty: false,
          variableInspectorEnabled: true,
          runtimeMode: 'node',
        },
      ],
      activeTabId: 'tab-ts',
    });
    renderCard();
    expect(screen.queryByTestId('floating-variables-card')).toBeNull();
  });

  it('flips variableInspectorEnabled off when the close button fires', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByLabelText(/close|cerrar/i));
    expect(setTabVariableInspectorEnabledMock).toHaveBeenCalledWith(
      'tab-ts',
      false,
    );
  });
});
