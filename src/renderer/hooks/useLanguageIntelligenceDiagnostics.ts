import type { Monaco, OnMount } from '@monaco-editor/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getLanguageIntelligenceAdapter } from '../languageIntelligence';

export const LINGUA_LANGUAGE_INTELLIGENCE_MARKER_OWNER = 'lingua-language-intelligence';

type EditorInstance = Parameters<OnMount>[0];

interface ActiveLanguageTab {
  id: string;
  language: string;
  content: string;
}

function markerSeverityFor(monaco: Monaco, severity: 'error' | 'warning' | 'info'): number {
  switch (severity) {
    case 'error':
      return monaco.MarkerSeverity.Error;
    case 'warning':
      return monaco.MarkerSeverity.Warning;
    case 'info':
    default:
      return monaco.MarkerSeverity.Info;
  }
}

export function useLanguageIntelligenceDiagnostics(
  editor: EditorInstance | null,
  monaco: Monaco | null,
  activeTab: ActiveLanguageTab | null | undefined
): void {
  const { i18n } = useTranslation();
  // Re-run when the UI locale flips so persisted markers refresh their
  // message text — `t()` resolves at analyze-time and Monaco doesn't
  // re-translate stored marker strings on its own.
  const locale = i18n.language;

  useEffect(() => {
    const model = editor?.getModel();
    if (!model || !monaco) return;

    const adapter = getLanguageIntelligenceAdapter(activeTab?.language);
    if (!adapter || !activeTab) {
      monaco.editor.setModelMarkers(model, LINGUA_LANGUAGE_INTELLIGENCE_MARKER_OWNER, []);
      return;
    }

    const timeout = window.setTimeout(() => {
      const result = adapter.analyze(activeTab.content);
      monaco.editor.setModelMarkers(
        model,
        LINGUA_LANGUAGE_INTELLIGENCE_MARKER_OWNER,
        result.diagnostics.map(diagnostic => ({
          startLineNumber: diagnostic.line,
          startColumn: diagnostic.column,
          endLineNumber: diagnostic.endLine ?? diagnostic.line,
          endColumn: diagnostic.endColumn ?? diagnostic.column + 1,
          message: diagnostic.message,
          severity: markerSeverityFor(monaco, diagnostic.severity),
          source: diagnostic.source,
        }))
      );
    }, 150);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeTab, editor, monaco, locale]);
}
