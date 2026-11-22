import { describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/tabLastAnswer', () => ({
  loadLastAnswer: () => Promise.reject(new Error('chunk failed to load')),
}));

import { useSessionStore } from '@/stores/sessionStore';
import { useEditorStore } from '@/stores/editorStore';

describe('session restore without the last-answer chunk', () => {
  it('restores the tabs and drops only their answers', async () => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'squares.js',
          language: 'javascript',
          content: '[1, 2].map(n => n * n)',
          lastAnswer: { kind: 'code', status: 'ok', numeral: '1 – 4', ranAt: 1_700_000_000_000 },
        },
      ],
      savedActiveIndex: 0,
    });

    await useSessionStore.getState().restoreSession();

    const tabs = useEditorStore.getState().tabs;
    expect(tabs.map(tab => tab.name)).toEqual(['squares.js']);
    expect(tabs[0]).not.toHaveProperty('lastAnswer');
  });
});
