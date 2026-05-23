import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGitDiffTabAvailable } from '../../../src/renderer/components/Editor/useGitDiffTabAvailable';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useGitStore } from '../../../src/renderer/stores/gitStore';

function setActiveSavedTab(content = 'console.log("hi")'): void {
  act(() => {
    useEditorStore.setState({
      activeTabId: 'tab-1',
      tabs: [
        {
          id: 'tab-1',
          name: 'foo.js',
          language: 'javascript',
          content,
          isDirty: false,
          filePath: '/tmp/repo/foo.js',
        },
      ],
    });
  });
}

describe('useGitDiffTabAvailable', () => {
  beforeEach(() => {
    act(() => {
      useGitStore.getState().clear();
      useEditorStore.setState({ activeTabId: null, tabs: [] });
    });
  });

  it('shows the tab for a saved file when git posture is available', () => {
    setActiveSavedTab();
    act(() => {
      useGitStore.getState().setPosture({
        available: true,
        repoRoot: '/tmp/repo',
        branch: 'main',
      });
    });

    const { result } = renderHook(() => useGitDiffTabAvailable());

    expect(result.current).toBe(true);
  });

  it('hides the tab when the file opts out with @git-ignore-status', () => {
    setActiveSavedTab('// @git-ignore-status\nconsole.log("hi")');
    act(() => {
      useGitStore.getState().setPosture({
        available: true,
        repoRoot: '/tmp/repo',
        branch: 'main',
      });
    });

    const { result } = renderHook(() => useGitDiffTabAvailable());

    expect(result.current).toBe(false);
  });
});
