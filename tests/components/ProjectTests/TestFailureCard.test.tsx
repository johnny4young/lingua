import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../src/renderer/i18n/testsCatalog';
import { TestFailureCard } from '../../../src/renderer/components/ProjectTests/TestFailureCard';
import { explainTestFailureText, type CodeChange } from '../../../src/renderer/components/ProjectTests/codeUnderTestChange';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useExplainPanelStore } from '../../../src/renderer/stores/explainPanelStore';
import { useProjectStore } from '../../../src/renderer/stores/projectStore';
import { useProjectTestStore, type ProjectTestDisplayCase } from '../../../src/renderer/stores/projectTestStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { asRootId } from '../../../src/shared/fs/brandedIds';
import { fakeEditor } from './fakeEditor';

const entitlement = vi.hoisted(() => ({ value: false }));
vi.mock('../../../src/renderer/hooks/useEntitlement', () => ({ useEntitlement: () => entitlement.value }));

const initialEditor = useEditorStore.getState();
const initialProject = useProjectStore.getState();
const initialTests = useProjectTestStore.getState();
const initialUi = useUIStore.getState();
const initialExplain = useExplainPanelStore.getState();

const entry: ProjectTestDisplayCase = {
  file: 'src/cart.test.ts',
  path: ['cart', 'ships free over 40'],
  status: 'failed',
  failureFile: 'src/cart.test.ts',
  failureLine: 10,
  failureMessage: 'AssertionError: expected 4.9 to be +0',
  expected: '0',
  received: '4.9',
};

const change: CodeChange = { file: 'src/shipping.ts', line: 4, removed: ['return total > 40 ? 0 : 4.9;'], added: ['return total >= 50 ? 0 : 4.9;'], more: 0 };

function seed() {
  useProjectStore.setState({ currentProject: { id: 'p', name: 'checkout', rootPath: '/work/checkout', openedAt: 1, rootId: asRootId('root-1') } });
  useProjectTestStore.setState({ rootId: asRootId('root-1'), projectName: 'checkout', status: 'ready', selectedFramework: 'vitest', focusedFailure: entry, cases: [entry] });
}

describe('TestFailureCard', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    entitlement.value = false;
    seed();
  });

  afterEach(() => {
    cleanup();
    useEditorStore.setState(initialEditor, true);
    useProjectStore.setState(initialProject, true);
    useProjectTestStore.setState(initialTests, true);
    useUIStore.setState(initialUi, true);
    useExplainPanelStore.setState(initialExplain, true);
  });

  it('shows the uncommitted change in the answer column without covering short lines', () => {
    const fake = fakeEditor();
    render(<TestFailureCard editor={fake.editor} monaco={fake.monaco} entry={entry} change={change} tabId="tab" answeredLines={[]} />);
    expect(screen.getByTestId('test-failure-change-file').textContent).toBe('shipping.ts');
    expect(screen.getByText('line 4')).toBeTruthy();
    expect(screen.getByText('changed, not committed')).toBeTruthy();
    expect(screen.getByTestId('test-failure-change').textContent).toContain('return total >= 50 ? 0 : 4.9;');
    expect(screen.getByTestId('test-failure-git-diff')).toBeTruthy();
    expect(fake.activeZones()).toEqual([]);
    expect(fake.widgets).toHaveLength(1);
    const wrapper = fake.widgets[0]!.getDomNode().firstElementChild as HTMLElement;
    // Right-aligned: the card ends 22 px before the content edge.
    expect(Number.parseInt(wrapper.style.width, 10)).toBe(1200 - 22);
  });

  it('reserves rows when the lines beside it would run under it', () => {
    const fake = fakeEditor({ lines: Array.from({ length: 20 }, () => 'x'.repeat(140)) });
    render(<TestFailureCard editor={fake.editor} monaco={fake.monaco} entry={entry} change={change} tabId="tab" answeredLines={[]} />);
    expect(fake.activeZones().map(zone => zone.afterLineNumber)).toEqual([10]);
  });

  it('reserves rows when another answer sits beside it', () => {
    const fake = fakeEditor();
    render(<TestFailureCard editor={fake.editor} monaco={fake.monaco} entry={entry} change={change} tabId="tab" answeredLines={[9, 10, 12]} />);
    expect(fake.activeZones().map(zone => zone.afterLineNumber)).toEqual([10]);
  });

  it('names the test when no change was found and offers no Git diff', () => {
    const fake = fakeEditor();
    render(<TestFailureCard editor={fake.editor} monaco={fake.monaco} entry={entry} change={null} tabId="tab" answeredLines={[]} />);
    expect(screen.getByText('cart › ships free over 40')).toBeTruthy();
    expect(screen.queryByTestId('test-failure-git-diff')).toBeNull();
    expect(screen.queryByTestId('test-failure-explain')).toBeNull();
  });

  it('opens the changed file with its Git diff tab', async () => {
    const openFile = vi.fn().mockResolvedValue(undefined);
    useEditorStore.setState({ openFile, requestReveal: vi.fn() });
    const fake = fakeEditor();
    render(<TestFailureCard editor={fake.editor} monaco={fake.monaco} entry={entry} change={change} tabId="tab" answeredLines={[]} />);
    await userEvent.setup().click(screen.getByTestId('test-failure-git-diff'));
    expect(openFile).toHaveBeenCalledWith('root-1', 'src/shipping.ts', 'shipping.ts', 'typescript', '/work/checkout/src/shipping.ts');
    expect(useUIStore.getState().activeBottomPanel).toBe('git-diff');
  });

  it('explains the failure with the change when local AI is available', async () => {
    entitlement.value = true;
    const fake = fakeEditor();
    render(<TestFailureCard editor={fake.editor} monaco={fake.monaco} entry={entry} change={change} tabId="tab" answeredLines={[]} />);
    await userEvent.setup().click(screen.getByTestId('test-failure-explain'));
    expect(useExplainPanelStore.getState().target).toEqual({ tabId: 'tab', errorMessage: explainTestFailureText(entry, change), line: 10, column: null });
    expect(explainTestFailureText(entry, change)).toContain('Uncommitted change in src/shipping.ts at line 4:\n- return total > 40 ? 0 : 4.9;\n+ return total >= 50 ? 0 : 4.9;');
  });

  it('runs the test again and closes on Close or Escape', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    useProjectTestStore.setState({ run });
    const fake = fakeEditor();
    render(<TestFailureCard editor={fake.editor} monaco={fake.monaco} entry={entry} change={change} tabId="tab" answeredLines={[]} />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('test-failure-run-again'));
    expect(run).toHaveBeenCalledWith({ rootId: 'root-1', projectName: 'checkout' }, { kind: 'test', file: 'src/cart.test.ts', path: ['cart', 'ships free over 40'] });

    // Esc goes to an open suggestion list first.
    fake.node.innerHTML = '<div class="suggest-widget visible"></div>';
    act(() => fake.pressEscape());
    expect(useProjectTestStore.getState().focusedFailure).not.toBeNull();
    fake.node.innerHTML = '';
    act(() => fake.pressEscape());
    expect(useProjectTestStore.getState().focusedFailure).toBeNull();

    seed();
    await user.click(await screen.findByTestId('test-failure-close'));
    expect(useProjectTestStore.getState().focusedFailure).toBeNull();
  });
});
