/** Deterministic browser fixture for test results in the editor: a project, a failed run and an uncommitted change. */

import { asRootId, type RelativePath, type RootId } from '../../shared/fs/brandedIds';
import type { ProjectTestCase, ProjectTestRunResult } from '../../shared/projectTests';
import { useEditorStore } from '../stores/editorStore';
import { gitDetectKey, useGitStore } from '../stores/gitStore';
import { useProjectStore } from '../stores/projectStore';
import { useProjectTerminalStore } from '../stores/projectTerminalStore';
import { useProjectTestStore } from '../stores/projectTestStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';

const rootId = asRootId('e2e-project-tests-editor-root');
const rootPath = '/fixtures/checkout-api';

const TEST_FILE = `import { describe, it, expect } from 'vitest';
import { subtotal, applyCoupon, shipping } from './cart';

const cart = [
  { sku: 'tee-01', price: 18.5, qty: 2 },
  { sku: 'mug-07', price: 9, qty: 1 },
];

describe('cart', () => {
  it('adds line totals', () => {
    expect(subtotal(cart)).toBe(46);
  });

  it('applies a percentage coupon', () => {
    expect(applyCoupon(46, 'TEN')).toBe(41.4);
  });

  it('ships free over 40', () => {
    expect(shipping(41.4)).toBe(0);
  });
});
`;

const CART = `export { shipping } from './shipping';

export const subtotal = (items) => items.reduce((sum, item) => sum + item.price * item.qty, 0);
export const applyCoupon = (total, code) => (code === 'TEN' ? total * 0.9 : total);
`;

const SHIPPING_HEAD = `// Flat shipping below the free threshold.

export function shipping(total) {
  return total > 40 ? 0 : 4.9;
}
`;

const SHIPPING_NOW = SHIPPING_HEAD.replace('total > 40', 'total >= 50');

const FILES: Record<string, { now: string; head: string }> = {
  'src/cart.test.ts': { now: TEST_FILE, head: TEST_FILE },
  'src/cart.ts': { now: CART, head: CART },
  'src/shipping.ts': { now: SHIPPING_NOW, head: SHIPPING_HEAD },
  'src/coupons.ts': { now: 'export const codes = [\'TEN\'];\n', head: 'export const codes = [];\n' },
  'src/coupons.test.ts': { now: 'export {};\n', head: 'export {};\n' },
  'src/shipping.test.ts': { now: 'export {};\n', head: 'export {};\n' },
  'notebooks/q4-review.linguanb': { now: '{}\n', head: '{}\n' },
  'package.json': { now: '{}\n', head: '{}\n' },
  'vitest.config.ts': { now: 'export default {};\n', head: 'export default {};\n' },
  'README.md': { now: '# checkout-api\n', head: '# checkout-api\n' },
};

const cases: ProjectTestCase[] = [
  { file: 'src/cart.test.ts', path: ['cart', 'adds line totals'], status: 'passed', durationMs: 2, declarationLine: 10 },
  { file: 'src/cart.test.ts', path: ['cart', 'applies a percentage coupon'], status: 'passed', durationMs: 1, declarationLine: 14 },
  {
    file: 'src/cart.test.ts',
    path: ['cart', 'ships free over 40'],
    status: 'failed',
    durationMs: 3,
    declarationLine: 18,
    failureFile: 'src/cart.test.ts',
    failureLine: 19,
    failureMessage: 'AssertionError: expected 4.9 to be +0 // Object.is equality',
    expected: '0',
    received: '4.9',
  },
  { file: 'src/coupons.test.ts', path: ['coupons', 'parses codes'], status: 'passed', durationMs: 1, declarationLine: 4 },
  { file: 'src/coupons.test.ts', path: ['coupons', 'rejects expired codes'], status: 'passed', durationMs: 2, declarationLine: 8 },
  { file: 'src/shipping.test.ts', path: ['shipping', 'charges below the threshold'], status: 'passed', durationMs: 3, declarationLine: 4 },
];

const result: ProjectTestRunResult = {
  kind: 'failed',
  framework: 'vitest',
  command: 'vitest run --no-color',
  orderedOutput: ' FAIL  src/cart.test.ts > cart > ships free over 40\n Tests  1 failed | 5 passed (6)\n',
  stdout: '',
  stderr: '',
  exitCode: 1,
  executionTime: 412,
  timeoutMs: 300_000,
  cases,
};

const absolute = (relative: string) => `${rootPath}/${relative}`;
const relativeFrom = (filePath: string) => (filePath.startsWith(`${rootPath}/`) ? filePath.slice(rootPath.length + 1) : filePath);

function listDirectory(relativePath: string) {
  const prefix = relativePath === '' ? '' : `${relativePath}/`;
  const names = new Map<string, boolean>();
  for (const file of Object.keys(FILES)) {
    if (!file.startsWith(prefix)) continue;
    const [name, ...rest] = file.slice(prefix.length).split('/');
    if (name) names.set(name, rest.length > 0);
  }
  return [...names].map(([name, isDirectory]) => ({ name, relativePath: `${prefix}${name}`, isDirectory }));
}

export function prepareProjectTestsEditorE2eFixture(): void {
  const original = window.lingua;
  const ours = (id: RootId) => id === rootId;
  window.lingua = {
    ...original,
    fs: {
      ...original.fs,
      readdir: async (id: RootId, relativePath: RelativePath) =>
        ours(id) ? listDirectory(relativePath) : original.fs.readdir(id, relativePath),
      read: async (id: RootId, relativePath: RelativePath) => {
        if (!ours(id)) return original.fs.read(id, relativePath);
        const file = FILES[relativePath];
        if (!file) throw new Error('ENOENT');
        return file.now;
      },
    },
    git: {
      detect: async () => ({ installed: true, repoRoot: rootPath, branch: 'main' }),
      status: async (_repoRoot: string, filePath: string) => {
        const file = FILES[relativeFrom(filePath)];
        return { status: !file ? 'unknown' : file.now === file.head ? 'clean' : 'modified', insertions: 1, deletions: 1 };
      },
      changes: async () => ({
        paths: Object.entries(FILES)
          .filter(([, file]) => file.now !== file.head)
          .map(([path]) => ({ path, status: 'modified' as const })),
        truncated: false,
      }),
      diff: async (_repoRoot: string, filePath: string) => {
        const file = FILES[relativeFrom(filePath)];
        return { originalContent: file?.head ?? '', modifiedContent: file?.now ?? '', truncated: false };
      },
      reveal: async () => true,
      watchHead: async () => ({ ok: true }),
      unwatchHead: async () => ({ ok: true }),
      onHeadChanged: () => () => undefined,
      onHeadWatcherFailed: () => () => undefined,
    },
    projectTests: {
      detect: async () => useProjectTestStore.getState().detection!,
      run: async (_id, framework, _runId, scope) => ({ ...result, framework, ...(scope ? { scope } : {}) }),
      stop: async () => ({ stopped: true }),
      onOutput: () => () => undefined,
    },
    projectTerminal: {
      start: async () => ({ ok: true, sessionId: 'e2e-terminal', shellName: 'zsh' }),
      write: async () => ({ written: true }),
      resize: async () => ({ resized: true }),
      stop: async () => ({ stopped: true }),
      onData: () => () => undefined,
      onExit: () => () => undefined,
    },
  } as typeof window.lingua;
  window.addEventListener('e2e-open-test-file', () => void openProjectTestsEditorE2eFile());
}

/** Opens the test file once the app shell is mounted, so session restore cannot replace it. */
async function openProjectTestsEditorE2eFile(): Promise<void> {
  useSettingsStore.setState({ nativeExecutionAcknowledged: true });
  useProjectStore.setState({
    currentProject: { id: rootPath, name: 'checkout-api', rootPath, openedAt: 1, rootId },
  });
  await useProjectStore.getState().refreshTree();
  await useProjectStore.getState().expandDirectory('src');
  await new Promise(resolve => setTimeout(resolve, 50));
  useProjectTerminalStore.setState({ rootId, projectName: 'checkout-api', status: 'running', sessionId: 'e2e-terminal', shellName: 'zsh' });
  useGitStore.setState({ posture: { available: true, repoRoot: rootPath, branch: 'main', commit: 'e2e' }, lastDetectKey: gitDetectKey(rootPath, rootId), lastDetectAt: Date.now() });
  useProjectTestStore.setState({
    rootId,
    projectName: 'checkout-api',
    status: 'ready',
    detection: { kind: 'ready', candidates: [{ framework: 'vitest', command: 'vitest run --no-color', evidence: ['vitest.config.ts'], available: true }] },
    selectedFramework: 'vitest',
    result,
    cases,
    casesTruncated: false,
    filter: 'all',
    runningScope: null,
    liveOutput: { stdout: '', stderr: '' },
    error: null,
    activeRunId: null,
  });

  await useEditorStore.getState().openFile(rootId, 'src/shipping.ts', 'shipping.ts', 'typescript', absolute('src/shipping.ts'));
  const relative = 'src/cart.test.ts';
  await useEditorStore.getState().openFile(rootId, relative, 'cart.test.ts', 'typescript', absolute(relative));
  useUIStore.setState({ activeBottomPanel: 'tests', consoleVisible: true, sidebarVisible: true });
}
