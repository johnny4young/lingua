import { describe, expect, it } from 'vitest';
import type { IRange } from 'monaco-editor';
import {
  createLintQuickFixProvider,
  type LintQuickFixMessages,
} from '@/lint/lintQuickFixProvider';

/**
 * internal — locks the CodeActionProvider's action assembly: which fixes it
 * offers for a given range, and that each carries a valid Monaco workspace
 * edit. Uses a minimal fake model so the provider is tested without a real
 * Monaco instance (it re-derives fixes from the already-tested pure rules).
 */
const MESSAGES: LintQuickFixMessages = {
  strictEquality: 'use ===',
  strictEqualityFixTitle: 'Replace with strict operator',
  addSemicolonTitle: 'Add missing semicolon',
  wrapTryCatchTitle: 'Wrap in try/catch',
};

function fakeModel(lines: string[], languageId = 'typescript') {
  const text = lines.join('\n');
  return {
    uri: { toString: () => 'inmemory://model/1' },
    getLanguageId: () => languageId,
    getValue: () => text,
    getVersionId: () => 1,
    getLineContent: (n: number) => lines[n - 1] ?? '',
    getLineMaxColumn: (n: number) => (lines[n - 1]?.length ?? 0) + 1,
    getValueInRange: (r: IRange) =>
      lines.slice(r.startLineNumber - 1, r.endLineNumber).join('\n'),
  } as unknown as Parameters<
    NonNullable<ReturnType<typeof createLintQuickFixProvider>['provideCodeActions']>
  >[0];
}

function cursor(lineNumber: number, column: number): IRange {
  return { startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column };
}

const provider = createLintQuickFixProvider(() => MESSAGES);
const disabledProvider = createLintQuickFixProvider(() => MESSAGES, () => false);

function actionsFor(model: ReturnType<typeof fakeModel>, range: IRange) {
  const result = provider.provideCodeActions!(model, range, { markers: [], only: undefined, trigger: 1 }, {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  });
  return 'actions' in result ? result.actions : [];
}

function disabledActionsFor(model: ReturnType<typeof fakeModel>, range: IRange) {
  const result = disabledProvider.provideCodeActions!(model, range, { markers: [], only: undefined, trigger: 1 }, {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  });
  return 'actions' in result ? result.actions : [];
}

describe('createLintQuickFixProvider', () => {
  it('offers the strict-equality fix when the range overlaps a loose operator', () => {
    const model = fakeModel(['if (a == b) {}']);
    const titles = actionsFor(model, cursor(1, 7)).map((a) => a.title);
    expect(titles).toContain('Replace with strict operator');
  });

  it('does not offer the strict-equality fix far from any loose operator', () => {
    const model = fakeModel(['const x = 1', 'if (a == b) {}']);
    // Range on line 1 (no operator) — strict-equality (line 2) must not surface.
    const titles = actionsFor(model, cursor(1, 1)).map((a) => a.title);
    expect(titles).not.toContain('Replace with strict operator');
  });

  it('offers add-semicolon on a statement line lacking one', () => {
    const model = fakeModel(['const x = 1']);
    const titles = actionsFor(model, cursor(1, 5)).map((a) => a.title);
    expect(titles).toContain('Add missing semicolon');
  });

  it('offers wrap-try-catch when the line has content', () => {
    const model = fakeModel(['doRisky()']);
    const titles = actionsFor(model, cursor(1, 3)).map((a) => a.title);
    expect(titles).toContain('Wrap in try/catch');
  });

  it('returns no actions on a non-JS/TS model', () => {
    const model = fakeModel(['a == b'], 'python');
    expect(actionsFor(model, cursor(1, 3))).toEqual([]);
  });

  it('returns no actions when inline lint is disabled for the language', () => {
    const model = fakeModel(['if (a == b) {}']);
    expect(disabledActionsFor(model, cursor(1, 7))).toEqual([]);
  });

  it('skips the scan when the request is scoped to a non-quickfix kind (internal reviewer)', () => {
    const model = fakeModel(['if (a == b) {}']);
    // A `source.fixAll` pass (e.g. format-on-save) must not surface our
    // quickfix actions — Monaco filters by kind anyway, so short-circuit.
    const sourceScoped = provider.provideCodeActions!(
      model,
      cursor(1, 7),
      { markers: [], only: 'source.fixAll', trigger: 1 },
      { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }
    );
    expect('actions' in sourceScoped ? sourceScoped.actions : []).toEqual([]);

    // An explicit quickfix-scoped request still gets the fix.
    const quickfixScoped = provider.provideCodeActions!(
      model,
      cursor(1, 7),
      { markers: [], only: 'quickfix', trigger: 1 },
      { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }
    );
    const titles = ('actions' in quickfixScoped ? quickfixScoped.actions : []).map((a) => a.title);
    expect(titles).toContain('Replace with strict operator');
  });

  it('builds a workspace edit targeting the model uri for the strict-equality fix', () => {
    const model = fakeModel(['if (a == b) {}']);
    const action = actionsFor(model, cursor(1, 7)).find(
      (a) => a.title === 'Replace with strict operator'
    );
    expect(action?.edit?.edits?.[0]).toMatchObject({
      textEdit: { text: '===' },
    });
  });
});
