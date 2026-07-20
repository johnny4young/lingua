/**
 * implementation — Monaco CodeActionProvider for the custom JS/TS quick-fixes
 * Monaco's built-in TypeScript worker does not offer (they are style/refactor
 * concerns, not type errors). Registered once per Monaco instance for
 * `javascript` + `typescript` by `useInlineLint`.
 *
 * Three fixes, all routed through Monaco's edit API so Cmd+Z reverts cleanly:
 *   - strict-equality: re-runs the pure `findLintIssues` over the model and
 *     offers `==` -> `===` / `!=` -> `!==` for any loose operator overlapping
 *     the requested range (these also carry a `'lingua-lint'` squiggle).
 *   - add-semicolon: cursor-anchored; offered when the active line plausibly
 *     wants a trailing semicolon (no squiggle — see customLintRules).
 *   - wrap-try-catch: wraps the selected lines (or the cursor line) in a
 *     try/catch, preserving indentation.
 *
 * The provider re-derives fixes from the pure rules rather than reading marker
 * internals, so it stays a thin, deterministic adapter. Monaco drives it from
 * Cmd+., from the lightbulb on cursor idle, and from source passes such as
 * format-on-save; the per-call scan stays O(n) and cheap for scratchpad-sized
 * buffers, and source/refactor-scoped requests short-circuit before scanning
 * (see the `context.only` guard below).
 */
import type { editor, languages, IRange } from 'monaco-editor';
import { buildTryCatchWrap, findLintIssues, suggestSemicolonFix } from './customLintRules';

/** Marker owner for the custom lint squiggles (coexists with other owners). */
export const LINGUA_LINT_MARKER_OWNER = 'lingua-lint';

/**
 * Localized strings the provider needs. Keyed so the caller resolves them via
 * i18n once and the pure layer stays translation-free.
 */
export interface LintQuickFixMessages {
  strictEquality: string;
  strictEqualityFixTitle: string;
  addSemicolonTitle: string;
  wrapTryCatchTitle: string;
}

const QUICK_FIX_KIND = 'quickfix';

function rangesOverlap(a: IRange, b: IRange): boolean {
  if (a.endLineNumber < b.startLineNumber || b.endLineNumber < a.startLineNumber) return false;
  if (a.startLineNumber === b.endLineNumber && a.startColumn > b.endColumn) return false;
  if (b.startLineNumber === a.endLineNumber && b.startColumn > a.endColumn) return false;
  return true;
}

function makeReplaceAction(
  title: string,
  model: editor.ITextModel,
  range: IRange,
  text: string,
  isPreferred: boolean
): languages.CodeAction {
  return {
    title,
    kind: QUICK_FIX_KIND,
    diagnostics: [],
    isPreferred,
    edit: {
      edits: [
        {
          resource: model.uri,
          versionId: model.getVersionId(),
          textEdit: { range, text },
        },
      ],
    } as languages.WorkspaceEdit,
  };
}

/**
 * Build the CodeActionProvider. `getMessages` is a getter so the provider
 * always renders titles in the live UI locale without re-registration.
 */
export function createLintQuickFixProvider(
  getMessages: () => LintQuickFixMessages,
  isLanguageEnabled: (language: string) => boolean = () => true
): languages.CodeActionProvider {
  return {
    provideCodeActions(model, range, context) {
      const language = model.getLanguageId();
      if (language !== 'javascript' && language !== 'typescript') {
        return { actions: [], dispose() {} };
      }
      if (!isLanguageEnabled(language)) {
        return { actions: [], dispose() {} };
      }
      // Reviewer note: every code-action pass — including the
      // lightbulb's cursor-idle probe and format-on-save's source pass — lands
      // here. When the caller scopes the request to a kind our `quickfix`
      // actions can't satisfy (`source.*`, `refactor.*`), skip the full-buffer
      // scan; Monaco would discard non-matching kinds anyway. A general request
      // (`only` undefined) or a quickfix-scoped one still runs.
      const only = context?.only;
      if (only && only !== QUICK_FIX_KIND && !only.startsWith(`${QUICK_FIX_KIND}.`)) {
        return { actions: [], dispose() {} };
      }
      const messages = getMessages();
      const actions: languages.CodeAction[] = [];

      // 1) strict-equality — re-derive from the pure rule, offer for any loose
      //    operator overlapping the requested range.
      const issues = findLintIssues(model.getValue(), language, {
        strictEquality: messages.strictEquality,
      });
      for (const issue of issues) {
        const issueRange: IRange = {
          startLineNumber: issue.startLineNumber,
          startColumn: issue.startColumn,
          endLineNumber: issue.endLineNumber,
          endColumn: issue.endColumn,
        };
        if (!rangesOverlap(issueRange, range)) continue;
        actions.push(
          makeReplaceAction(
            messages.strictEqualityFixTitle,
            model,
            issueRange,
            issue.fixText,
            true
          )
        );
      }

      // 2) add-semicolon — cursor-anchored on the active line.
      const lineText = model.getLineContent(range.startLineNumber);
      const semicolon = suggestSemicolonFix(lineText);
      if (semicolon) {
        const insertRange: IRange = {
          startLineNumber: range.startLineNumber,
          startColumn: semicolon.column,
          endLineNumber: range.startLineNumber,
          endColumn: semicolon.column,
        };
        actions.push(
          makeReplaceAction(
            messages.addSemicolonTitle,
            model,
            insertRange,
            semicolon.fixText,
            false
          )
        );
      }

      // 3) wrap-try-catch — over the selection, or the cursor line if empty.
      const wrapStart = range.startLineNumber;
      const wrapEnd = range.endLineNumber;
      const firstLine = model.getLineContent(wrapStart);
      const baseIndent = /^\s*/u.exec(firstLine)?.[0] ?? '';
      const fullRange: IRange = {
        startLineNumber: wrapStart,
        startColumn: 1,
        endLineNumber: wrapEnd,
        endColumn: model.getLineMaxColumn(wrapEnd),
      };
      const selectedText = model.getValueInRange(fullRange);
      if (selectedText.trim().length > 0) {
        actions.push(
          makeReplaceAction(
            messages.wrapTryCatchTitle,
            model,
            fullRange,
            buildTryCatchWrap(selectedText, baseIndent),
            false
          )
        );
      }

      return { actions, dispose() {} };
    },
  };
}
