import type { Monaco, OnMount } from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findLintIssues } from '../lint/customLintRules';
import {
  createLintQuickFixProvider,
  LINGUA_LINT_MARKER_OWNER,
  type LintQuickFixMessages,
} from '../lint/lintQuickFixProvider';
import { setMonacoInlineLintEnabled } from '../monaco';
import { useSettingsStore } from '../stores/settingsStore';
import { trackEvent } from '../utils/telemetry';

type EditorInstance = Parameters<OnMount>[0];

/** Languages Slice 1 lints. */
const LINTABLE = new Set(['javascript', 'typescript']);

/**
 * Session-scoped de-dupe for `editor.lint_diagnostic_emitted`. We only care
 * "did the user hit rule X this session", not per-keystroke counts, so each
 * `${language}:${severity}:${ruleId}` fires at most once per renderer session.
 * Module-level so it survives component remounts within a session.
 */
const sessionEmittedLintKeys = new Set<string>();

function emitLintTelemetryOnce(language: string, severity: string, ruleId: string): void {
  const key = `${language}:${severity}:${ruleId}`;
  if (sessionEmittedLintKeys.has(key)) return;
  sessionEmittedLintKeys.add(key);
  void trackEvent('editor.lint_diagnostic_emitted', { language, severity, ruleId });
}

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

interface ActiveLintTab {
  id: string;
  language: string;
  content: string;
}

/**
 * RL-108 — wire inline lint over Monaco's existing JS/TS analysis. Three
 * concerns, all gated by the per-language `inlineLintEnabledByLanguage` setting:
 *
 *  1. Native toggle — flip Monaco's built-in TS/JS diagnostics on/off per
 *     language via `setMonacoInlineLintEnabled` (the squiggles that already
 *     ship). Re-applied whenever the setting changes.
 *  2. Custom rules — run the pure `findLintIssues` (debounced 500 ms) over the
 *     active JS/TS buffer and publish `'lingua-lint'` markers (the rules Monaco
 *     does not provide, e.g. `==` -> `===`). Paused on hidden tab; cleared when
 *     disabled or on a non-JS/TS tab.
 *  3. Quick-fixes — register the CodeActionProvider once per Monaco instance.
 *
 * Adoption telemetry (`editor.lint_diagnostic_emitted`) fires at most once per
 * session per (language, severity, ruleId), separating Monaco's `ts-native`
 * diagnostics from the custom rules (fold F). No code or positions are sent.
 */
export function useInlineLint(
  editor: EditorInstance | null,
  monaco: Monaco | null,
  activeTab: ActiveLintTab | null | undefined
): void {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const inlineLintEnabledByLanguage = useSettingsStore(
    (state) => state.inlineLintEnabledByLanguage
  );
  const [documentVisible, setDocumentVisible] = useState(isDocumentVisible);

  // Localized quick-fix titles read through a ref so the provider (registered
  // once) always renders the live locale without re-registration. The ref is
  // updated in an effect (never during render) and read lazily by the provider
  // (Cmd+.) and the debounced marker pass — both run after effects, so the ref
  // is always current by the time it is read.
  const messagesRef = useRef<LintQuickFixMessages>({
    strictEquality: t('editor.lint.strictEquality.message'),
    strictEqualityFixTitle: t('editor.quickFix.strictEquality'),
    addSemicolonTitle: t('editor.quickFix.addSemicolon'),
    wrapTryCatchTitle: t('editor.quickFix.wrapTryCatch'),
  });
  useEffect(() => {
    messagesRef.current = {
      strictEquality: t('editor.lint.strictEquality.message'),
      strictEqualityFixTitle: t('editor.quickFix.strictEquality'),
      addSemicolonTitle: t('editor.quickFix.addSemicolon'),
      wrapTryCatchTitle: t('editor.quickFix.wrapTryCatch'),
    };
  }, [t, locale]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const handleVisibilityChange = () => {
      setDocumentVisible(isDocumentVisible());
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    handleVisibilityChange();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // 1) Native Monaco diagnostics toggle, per language.
  useEffect(() => {
    if (!monaco) return;
    setMonacoInlineLintEnabled(monaco, 'javascript', inlineLintEnabledByLanguage.javascript !== false);
    setMonacoInlineLintEnabled(monaco, 'typescript', inlineLintEnabledByLanguage.typescript !== false);
  }, [monaco, inlineLintEnabledByLanguage]);

  // 3) Register the quick-fix provider once per Monaco instance for JS + TS.
  useEffect(() => {
    if (!monaco) return undefined;
    const provider = createLintQuickFixProvider(
      () => messagesRef.current,
      (language) => useSettingsStore.getState().inlineLintEnabledByLanguage[language] !== false
    );
    const disposables = [
      monaco.languages.registerCodeActionProvider('javascript', provider),
      monaco.languages.registerCodeActionProvider('typescript', provider),
    ];
    return () => {
      for (const d of disposables) d.dispose();
    };
  }, [monaco]);

  // 2) Custom-rule markers (debounced) + adoption telemetry.
  useEffect(() => {
    const model = editor?.getModel();
    if (!model || !monaco || !activeTab) return undefined;

    const language = activeTab.language;
    const enabled = LINTABLE.has(language) && inlineLintEnabledByLanguage[language] !== false;

    if (!enabled) {
      monaco.editor.setModelMarkers(model, LINGUA_LINT_MARKER_OWNER, []);
      return undefined;
    }
    if (!documentVisible) return undefined;

    const timeout = window.setTimeout(() => {
      const issues = findLintIssues(activeTab.content, language, {
        strictEquality: messagesRef.current.strictEquality,
      });
      monaco.editor.setModelMarkers(
        model,
        LINGUA_LINT_MARKER_OWNER,
        issues.map((issue) => ({
          startLineNumber: issue.startLineNumber,
          startColumn: issue.startColumn,
          endLineNumber: issue.endLineNumber,
          endColumn: issue.endColumn,
          message: issue.message,
          severity: monaco.MarkerSeverity.Warning,
          source: LINGUA_LINT_MARKER_OWNER,
        }))
      );
      for (const issue of issues) {
        emitLintTelemetryOnce(language, 'warning', issue.ruleId);
      }
      // Sample Monaco's built-in TS/JS diagnostics for the `ts-native` signal.
      for (const marker of monaco.editor.getModelMarkers({ resource: model.uri })) {
        if (marker.owner === 'javascript' || marker.owner === 'typescript') {
          emitLintTelemetryOnce(language, severityToken(monaco, marker.severity), 'ts-native');
        }
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [editor, monaco, activeTab, inlineLintEnabledByLanguage, locale, documentVisible]);
}

function severityToken(monaco: Monaco, severity: number): 'error' | 'warning' | 'info' {
  if (severity === monaco.MarkerSeverity.Error) return 'error';
  if (severity === monaco.MarkerSeverity.Warning) return 'warning';
  return 'info';
}
