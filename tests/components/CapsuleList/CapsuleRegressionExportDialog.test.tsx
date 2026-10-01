import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapsuleRegressionExportDialog } from '../../../src/renderer/components/CapsuleList/CapsuleRegressionExportDialog';
import { useEditorStore, createDefaultTab } from '../../../src/renderer/stores/editorStore';
import { useProjectStore } from '../../../src/renderer/stores/projectStore';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';
import { asRootId, asRelativePath } from '../../../src/shared/fs/brandedIds';
import { parseCapsuleRegressionSuite } from '../../../src/shared/capsuleRegressionSuite';
import { saveOrDownloadTextFile } from '../../../src/renderer/utils/saveTextFileToDisk';
vi.mock('../../../src/renderer/utils/saveTextFileToDisk', () => ({
  saveOrDownloadTextFile: vi.fn(),
}));
const rootId = asRootId('case-ui');
beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({
    currentProject: {
      id: 'project',
      name: 'test',
      rootPath: '/private/project',
      rootId,
      openedAt: 0,
    },
  });
  useEditorStore.setState({
    tabs: [
      {
        ...createDefaultTab('javascript'),
        id: 'target',
        name: 'hello.js',
        content: 'console.log("current dirty")',
        rootId,
        relativePath: asRelativePath('src/hello.js'),
        filePath: '/private/project/src/hello.js',
        isDirty: true,
      },
    ],
    activeTabId: 'target',
  });
});
afterEach(() => {
  cleanup();
  useProjectStore.setState({ currentProject: null });
});
const show = () =>
  render(<CapsuleRegressionExportDialog capsule={FIXTURE_MINIMAL_JS} onClose={vi.fn()} />);
describe('inert regression export', () => {
  it('requires explicit target/review and retains the complete untouched oracle', async () => {
    show();
    const button = screen.getByRole('button', { name: 'Export case as suite' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'target' } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('regression-target-preview').textContent).toContain('current dirty');
    expect(screen.getByText(/CLI reads the saved file/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    await waitFor(() => expect(saveOrDownloadTextFile).toHaveBeenCalledTimes(1));
    const [raw] = vi.mocked(saveOrDownloadTextFile).mock.calls[0]!;
    const parsed = parseCapsuleRegressionSuite(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.suite.cases[0]!.baseline).toEqual(FIXTURE_MINIMAL_JS);
      expect(parsed.suite.cases[0]!.target).toBe('src/hello.js');
    }
    expect(raw).not.toContain('/private/project');
    expect(raw).not.toContain('current dirty');
  });
  it('resets review when selected source changes and refuses incomplete baselines', async () => {
    const view = show();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'target' } });
    fireEvent.click(screen.getByRole('checkbox'));
    act(() =>
      useEditorStore.setState(state => ({
        tabs: state.tabs.map(tab => ({ ...tab, content: 'new text' })),
      }))
    );
    await waitFor(() =>
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    );
    const baseline = structuredClone(FIXTURE_MINIMAL_JS);
    baseline.privacy.omittedFields = ['input.stdin'];
    view.rerender(<CapsuleRegressionExportDialog capsule={baseline} onClose={vi.fn()} />);
    expect(
      (screen.getByRole('button', { name: 'Export case as suite' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
  it('previews a suite without invoking execution or export', async () => {
    show();
    const artifact = {
      kind: 'lingua-regression-suite',
      suiteVersion: 1,
      cases: [{ id: 'case', name: 'case', target: 'hello.js', baseline: FIXTURE_MINIMAL_JS }],
    };
    const file = new File([JSON.stringify(artifact)], 'regression.json', {
      type: 'application/json',
    });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(artifact) });
    fireEvent.change(screen.getByLabelText('Inspect a suite without execution'), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByTestId('regression-import-preview').textContent).toContain('hello.js')
    );
    expect(saveOrDownloadTextFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0]!.content).toBe('console.log("current dirty")');
  });
  it('rejects malformed imported data and exposes no targets from another root', async () => {
    useProjectStore.setState({ currentProject: null });
    show();
    expect(screen.getByRole('combobox').querySelectorAll('option')).toHaveLength(1);
    const file = new File(['{}'], 'bad.json');
    Object.defineProperty(file, 'text', { value: async () => '{}' });
    fireEvent.change(screen.getByLabelText('Inspect a suite without execution'), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Invalid artifact')
    );
    expect(screen.queryByTestId('regression-import-preview')).toBeNull();
  });
  it('discards a late import after a newer selection', async () => {
    show();
    let finish!: (value: string) => void;
    const late = new File(['pending'], 'old.json');
    Object.defineProperty(late, 'text', {
      value: () =>
        new Promise<string>(resolve => {
          finish = resolve;
        }),
    });
    const picker = screen.getByLabelText('Inspect a suite without execution');
    fireEvent.change(picker, { target: { files: [late] } });
    const invalid = new File(['{}'], 'new.json');
    Object.defineProperty(invalid, 'text', { value: async () => '{}' });
    fireEvent.change(picker, { target: { files: [invalid] } });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Invalid artifact')
    );
    await act(async () =>
      finish(
        JSON.stringify({
          kind: 'lingua-regression-suite',
          suiteVersion: 1,
          cases: [{ id: 'old', name: 'old', target: 'hello.js', baseline: FIXTURE_MINIMAL_JS }],
        })
      )
    );
    expect(screen.queryByTestId('regression-import-preview')).toBeNull();
    expect(saveOrDownloadTextFile).not.toHaveBeenCalled();
  });
  it.each(['lineResults', 'richOutputs'] as const)(
    'refuses unsupported %s evidence rather than dropping it',
    field => {
      const capsule = structuredClone(FIXTURE_MINIMAL_JS);
      capsule.result[field] = [{ unsupported: true }];
      render(<CapsuleRegressionExportDialog capsule={capsule} onClose={vi.fn()} />);
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'target' } });
      fireEvent.click(screen.getByRole('checkbox'));
      expect(
        (screen.getByRole('button', { name: 'Export case as suite' }) as HTMLButtonElement).disabled
      ).toBe(true);
      expect(screen.getByRole('status').textContent).toContain('complete successful');
      expect(saveOrDownloadTextFile).not.toHaveBeenCalled();
    }
  );
  it('initializes a newly selected capsule after an inert null mount', async () => {
    const view = render(<CapsuleRegressionExportDialog capsule={null} onClose={vi.fn()} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    view.rerender(<CapsuleRegressionExportDialog capsule={FIXTURE_MINIMAL_JS} onClose={vi.fn()} />);
    expect((screen.getByRole('textbox', { name: 'Case name' }) as HTMLInputElement).value).toBe(
      FIXTURE_MINIMAL_JS.tab.name
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'target' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(
      (screen.getByRole('button', { name: 'Export case as suite' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });
});
