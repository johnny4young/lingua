import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestLineAnswers } from '../../../src/renderer/components/ProjectTests/TestLineAnswers';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useGitStore } from '../../../src/renderer/stores/gitStore';
import { useProjectStore } from '../../../src/renderer/stores/projectStore';
import { useProjectTestStore, type ProjectTestDisplayCase } from '../../../src/renderer/stores/projectTestStore';
import { useResultStore } from '../../../src/renderer/stores/resultStore';
import { useTimelineStore } from '../../../src/renderer/stores/timelineStore';
import { asRootId } from '../../../src/shared/fs/brandedIds';
import { fakeEditor } from './fakeEditor';

const initialEditor = useEditorStore.getState();
const initialProject = useProjectStore.getState();
const initialTests = useProjectTestStore.getState();
const initialGit = useGitStore.getState();
const initialResults = useResultStore.getState();
const initialTimeline = useTimelineStore.getState();
const originalLingua = window.lingua;

const source = [
  "import { describe, it, expect } from 'vitest';",
  "import { subtotal, shipping } from './cart';",
  '',
  "describe('cart', () => {",
  "  it('adds line totals', () => {",
  '    expect(subtotal([])).toBe(0);',
  '  });',
  "  it('ships free over 40', () => {",
  '    expect(shipping(41.4)).toBe(0);',
  '  });',
  "  it('skips', () => {});",
  '});',
].join('\n');

const failed: ProjectTestDisplayCase = {
  file: 'src/cart.test.ts',
  path: ['cart', 'ships free over 40'],
  status: 'failed',
  durationMs: 3,
  declarationLine: 8,
  failureFile: 'src/cart.test.ts',
  failureLine: 9,
  failureMessage: 'AssertionError: expected 4.9 to be +0',
  expected: '0',
  received: '4.9',
};

const cases: ProjectTestDisplayCase[] = [
  { file: 'src/cart.test.ts', path: ['cart', 'adds line totals'], status: 'passed', durationMs: 2, declarationLine: 5 },
  failed,
  { file: 'src/cart.test.ts', path: ['cart', 'skips'], status: 'skipped', declarationLine: 11 },
];

const FILES: Record<string, [string, string]> = {
  '/work/checkout/src/cart.ts': ["export { shipping } from './shipping';\n", "export { shipping } from './shipping';\n"],
  '/work/checkout/src/shipping.ts': ['//\n\n\nreturn total > 40 ? 0 : 4.9;\n', '//\n\n\nreturn total >= 50 ? 0 : 4.9;\n'],
};

function seed() {
  useEditorStore.setState({
    tabs: [{ id: 'tab', name: 'cart.test.ts', language: 'typescript', content: source, isDirty: false, rootId: 'root-1', relativePath: 'src/cart.test.ts' }],
    activeTabId: 'tab',
  });
  useProjectStore.setState({ currentProject: { id: 'p', name: 'checkout', rootPath: '/work/checkout', openedAt: 1, rootId: asRootId('root-1') } });
  useGitStore.setState({ posture: { available: true, repoRoot: '/work/checkout', commit: 'abc' } });
  useProjectTestStore.setState({ rootId: asRootId('root-1'), projectName: 'checkout', status: 'ready', selectedFramework: 'vitest', cases, focusedFailure: null });
  window.lingua = {
    ...originalLingua,
    fs: {
      ...originalLingua?.fs,
      readdir: vi.fn(async () => [
        { name: 'cart.ts', relativePath: 'src/cart.ts', isDirectory: false },
        { name: 'shipping.ts', relativePath: 'src/shipping.ts', isDirectory: false },
      ]),
    },
    git: {
      ...originalLingua?.git,
      diff: vi.fn(async (_root: string, file: string) => {
        const [originalContent, modifiedContent] = FILES[file] ?? ['', ''];
        return { originalContent, modifiedContent, truncated: false };
      }),
    },
  } as typeof window.lingua;
}

const answerText = (line: number) => document.querySelector(`[data-testid="test-line-answer"][data-line="${line}"]`)?.textContent;

describe('TestLineAnswers', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    seed();
  });

  afterEach(() => {
    cleanup();
    window.lingua = originalLingua;
    useEditorStore.setState(initialEditor, true);
    useProjectStore.setState(initialProject, true);
    useProjectTestStore.setState(initialTests, true);
    useGitStore.setState(initialGit, true);
    useResultStore.setState(initialResults, true);
    useTimelineStore.setState(initialTimeline, true);
  });

  it('answers the suite, each test and the failing assertion on their lines', async () => {
    const fake = fakeEditor({ lines: source.split('\n') });
    render(<TestLineAnswers editor={fake.editor} monaco={fake.monaco} />);
    await waitFor(() => expect(document.querySelectorAll('[data-testid="test-line-answer"]')).toHaveLength(5));
    expect(answerText(4)).toBe('Suite1 of 2 passed');
    expect(answerText(5)).toBe('Passedok2 ms');
    expect(answerText(8)).toBe('Failed3 ms · at line 9');
    expect(answerText(9)).toBe('Received4.9expected0');
    expect(answerText(11)).toBe('Skipped');
  });

  it('marks the answered lines on the rail and tints the failing assertion', async () => {
    const fake = fakeEditor({ lines: source.split('\n') });
    render(<TestLineAnswers editor={fake.editor} monaco={fake.monaco} />);
    await waitFor(() => expect(fake.editor.createDecorationsCollection).toHaveBeenCalled());
    const marks = vi.mocked(fake.editor.createDecorationsCollection).mock.calls.at(-1)![0]!;
    const rail = marks
      .filter(mark => mark.options.linesDecorationsClassName)
      .map(mark => [mark.range.startLineNumber, mark.options.linesDecorationsClassName]);
    // A tick on the suite and the passing test, lit where a test failed, the cross on its assertion; nothing for a skipped test.
    expect(rail).toEqual([
      [4, 'lingua-rail lingua-rail--answered'],
      [5, 'lingua-rail lingua-rail--answered'],
      [8, 'lingua-rail lingua-rail--reached'],
      [9, 'lingua-rail lingua-rail--raised'],
    ]);
    const tint = marks.filter(mark => mark.options.className === 'test-error-line');
    expect(tint.map(mark => mark.range.startLineNumber)).toEqual([9]);
    // The tint ends past the tag at the column's start (1200 * 0.42 wide, 22 px from the right edge).
    await waitFor(() => expect(fake.node.style.getPropertyValue('--answer-column-start')).toBe(`${1200 - 22 - 504}px`));
  });

  it('labels the answer column over the editor unless a code run of the file owns it', async () => {
    const fake = fakeEditor({ lines: source.split('\n') });
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    const { unmount } = render(<TestLineAnswers editor={fake.editor} monaco={fake.monaco} headerSlot={slot} />);
    await waitFor(() => expect(slot.querySelector('[data-testid="answer-column-header"]')).not.toBeNull());
    expect(slot.textContent).toBe('You writeLingua answers· Test results on the line');

    // A code run of the file takes the column while it runs, before it has answers, and while they show.
    act(() => useResultStore.setState({ ranCode: { tabId: 'tab' } as never, isManualRunning: true }));
    expect(slot.querySelector('[data-testid="answer-column-header"]')).toBeNull();
    act(() => useResultStore.setState({ isManualRunning: false, lineResults: [{ line: 6, value: '0' }] as never }));
    expect(slot.querySelector('[data-testid="answer-column-header"]')).toBeNull();
    const marks = vi.mocked(fake.editor.createDecorationsCollection).mock.calls.at(-1)![0]!;
    expect(marks.some(mark => mark.options.linesDecorationsClassName)).toBe(false);
    unmount();
    slot.remove();
  });

  it('keeps the tint under all of a failing line that runs into the column', async () => {
    const fake = fakeEditor({ lines: source.split('\n'), contentWidth: 600 });
    render(<TestLineAnswers editor={fake.editor} monaco={fake.monaco} />);
    const tintOf = () =>
      vi
        .mocked(fake.editor.createDecorationsCollection)
        .mock.calls.at(-1)![0]!
        .find(mark => mark.options.marginClassName === 'test-error-margin')?.options.className;
    await waitFor(() => expect(tintOf()).toBe('test-error-line test-error-line--full'));
  });

  it('leaves the rail to a recorded run or a debugger pause of the file', async () => {
    useTimelineStore.setState({ recording: { tabId: 'tab' } as never });
    const fake = fakeEditor({ lines: source.split('\n') });
    render(<TestLineAnswers editor={fake.editor} monaco={fake.monaco} />);
    await waitFor(() => expect(fake.editor.createDecorationsCollection).toHaveBeenCalled());
    const marks = vi.mocked(fake.editor.createDecorationsCollection).mock.calls.at(-1)![0]!;
    expect(marks.some(mark => mark.options.linesDecorationsClassName)).toBe(false);
    expect(marks.some(mark => mark.options.marginClassName === 'test-error-margin')).toBe(true);
  });

  it('keeps the header when a code run left only hidden undefined results', async () => {
    useResultStore.setState({ ranCode: { tabId: 'tab' } as never, lineResults: [{ line: 6, type: 'result', value: 'undefined' }] as never });
    const fake = fakeEditor({ lines: source.split('\n') });
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    const { unmount } = render(<TestLineAnswers editor={fake.editor} monaco={fake.monaco} headerSlot={slot} />);
    await waitFor(() => expect(slot.querySelector('[data-testid="answer-column-header"]')).not.toBeNull());
    unmount();
    slot.remove();
  });

  it('leaves stale results off the rail', async () => {
    useProjectTestStore.setState({ cases: cases.map(entry => ({ ...entry, stale: true })) });
    const fake = fakeEditor({ lines: source.split('\n') });
    render(<TestLineAnswers editor={fake.editor} monaco={fake.monaco} />);
    await act(async () => undefined);
    const calls = vi.mocked(fake.editor.createDecorationsCollection).mock.calls;
    expect(calls.every(([marks]) => (marks ?? []).length === 0)).toBe(true);
  });

  it('lines the answers up in one column', async () => {
    const fake = fakeEditor({ lines: source.split('\n') });
    render(<TestLineAnswers editor={fake.editor} monaco={fake.monaco} />);
    await waitFor(() => expect(fake.widgets.every(widget => widget.getDomNode().style.width !== '')).toBe(true));
    // Each widget starts at its line end, so line end plus width is the same right edge.
    const rights = fake.widgets.map(widget => {
      const line = widget.getPosition()!.position!.lineNumber;
      return (source.split('\n')[line - 1]!.length) * 8 + Number.parseInt(widget.getDomNode().style.width, 10);
    });
    expect(new Set(rights).size).toBe(1);
  });

  it('opens the card with the change under test from the failing line', async () => {
    const fake = fakeEditor({ lines: source.split('\n') });
    render(<TestLineAnswers editor={fake.editor} monaco={fake.monaco} />);
    await waitFor(() => expect(screen.getByTestId('test-line-show-failure')).toBeTruthy());
    await userEvent.setup({ pointerEventsCheck: 0 }).click(screen.getByTestId('test-line-show-failure'));
    expect(useProjectTestStore.getState().focusedFailure).toEqual({ file: 'src/cart.test.ts', path: ['cart', 'ships free over 40'] });
    await waitFor(() => expect(screen.getByTestId('test-failure-card')).toBeTruthy());
    expect(screen.getByTestId('test-failure-change-file').textContent).toBe('shipping.ts');
    expect(screen.getByTestId('test-line-open-change').textContent).toBe('Open shipping.ts:4');
  });

  it('says nothing for a file from another project', async () => {
    useProjectTestStore.setState({ rootId: asRootId('root-2') });
    const fake = fakeEditor({ lines: source.split('\n') });
    render(<TestLineAnswers editor={fake.editor} monaco={fake.monaco} />);
    await act(async () => undefined);
    expect(fake.widgets).toHaveLength(0);
  });
});
