import type { Monaco } from '@monaco-editor/react';
import i18next from 'i18next';
import { providePythonHover } from '../../../languageIntelligence/python';
import type { LanguageIntelligenceHover } from '../../../languageIntelligence/types';

type HoverProvider = Parameters<Monaco['languages']['registerHoverProvider']>[1];
type ProvideHover = NonNullable<HoverProvider['provideHover']>;
type HoverModel = Parameters<ProvideHover>[0];
type HoverPosition = Parameters<ProvideHover>[1];

function kindLabel(hover: LanguageIntelligenceHover): string {
  const key =
    hover.kind === 'function'
      ? 'languageIntelligence.python.hover.functionLabel'
      : hover.kind === 'class'
        ? 'languageIntelligence.python.hover.classLabel'
        : hover.kind === 'module'
          ? 'languageIntelligence.python.hover.moduleLabel'
          : 'languageIntelligence.python.hover.variableLabel';
  return i18next.t(key);
}

export function createPythonHoverProvider(): HoverProvider {
  return {
    provideHover(model: HoverModel, position: HoverPosition) {
      const hover = providePythonHover(model.getValue(), position.lineNumber, position.column);
      if (!hover) return null;

      const word = model.getWordAtPosition(position);
      if (!word || word.word !== hover.symbol) return null;

      const headerLine = hover.secondary
        ? `**${hover.symbol}**${hover.secondary} — ${kindLabel(hover)}`
        : `**${hover.symbol}** — ${kindLabel(hover)}`;
      const footerLine = i18next.t('languageIntelligence.python.hover.definedAt', {
        line: hover.definedAtLine,
      });

      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        },
        contents: [{ value: headerLine }, { value: footerLine }],
      };
    },
  };
}
