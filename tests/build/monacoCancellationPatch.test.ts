import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Delayer } from 'monaco-editor/esm/vs/base/common/async.js';
import { errorHandler, onUnexpectedError } from 'monaco-editor/esm/vs/base/common/errors.js';
const original = errorHandler.unexpectedErrorHandler;
afterEach(() => (errorHandler.unexpectedErrorHandler = original));
describe('Monaco owned delayed-task cancellation patch', () => {
  it('is wired into the authoritative lock and all affected installed call sites', () => {
    expect(readFileSync('pnpm-workspace.yaml', 'utf8')).toContain(
      'monaco-editor@0.55.1: patches/monaco-editor@0.55.1.patch'
    );
    expect(readFileSync('pnpm-lock.yaml', 'utf8')).toContain(
      'patchedDependencies:\n  monaco-editor@0.55.1:'
    );
    const monacoRoot = path.dirname(require.resolve('monaco-editor/package.json'));
    const tree = readFileSync(
      path.join(monacoRoot, 'esm/vs/base/browser/ui/tree/abstractTree.js'),
      'utf8'
    );
    expect(tree).toContain(
      'activeNodesEmitter.fire([...set.values()]);\n            }).catch(onUnexpectedError);'
    );
    const highlighter = readFileSync(
      path.join(monacoRoot, 'esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js'),
      'utf8'
    );
    expect(
      highlighter.match(/runDelayer\.trigger\([^\n]+\.catch\(onUnexpectedError\);/g)
    ).toHaveLength(3);
  });
  it('owns cancellation during dispose without running the stale task', async () => {
    const unexpected = vi.fn();
    errorHandler.unexpectedErrorHandler = unexpected;
    const task = vi.fn();
    const delayed = new Delayer(50);
    const owned = delayed.trigger(task).catch(onUnexpectedError);
    delayed.dispose();
    await owned;
    expect(task).not.toHaveBeenCalled();
    expect(unexpected).not.toHaveBeenCalled();
  });
  it('continues reporting unexpected task failures', async () => {
    const unexpected = vi.fn();
    errorHandler.unexpectedErrorHandler = unexpected;
    const failure = new Error('unexpected navigation task error');
    const delayed = new Delayer(0);
    await delayed
      .trigger(() => {
        throw failure;
      })
      .catch(onUnexpectedError);
    expect(unexpected).toHaveBeenCalledWith(failure);
    delayed.dispose();
  });
});
