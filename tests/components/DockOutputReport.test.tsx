import { act, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DockOutputReport } from '../../src/renderer/components/Layout/DockOutputReport';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useResultStore } from '../../src/renderer/stores/resultStore';

beforeEach(async () => {
  await initI18n();
  await i18next.changeLanguage('en');
});

describe('DockOutputReport', () => {
  function openTab(language: string, name: string) {
    act(() => {
      useEditorStore.setState({
        tabs: [{ id: 't', name, language, content: '', isDirty: false }] as never,
        activeTabId: 't',
      });
    });
  }

  it('shows the validation report above the Console rows', () => {
    openTab('json', 'data.json');
    act(() => useResultStore.setState({ fullOutput: 'Line 2: Unexpected token' }));
    render(<DockOutputReport />);
    expect(screen.getByTestId('dock-output-report').textContent).toContain('Unexpected token');
  });

  it('stays hidden for run tabs, whose output streams into Console', () => {
    openTab('javascript', 'main.js');
    act(() => useResultStore.setState({ fullOutput: 'hello' }));
    render(<DockOutputReport />);
    expect(screen.queryByTestId('dock-output-report')).toBeNull();
  });
});
