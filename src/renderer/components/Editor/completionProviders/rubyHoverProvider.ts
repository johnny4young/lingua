import type { Monaco } from '@monaco-editor/react';
import i18next from 'i18next';
import { provideRubyHover } from '../../../languageIntelligence/ruby';
import type { LanguageIntelligenceHover } from '../../../languageIntelligence/types';

type HoverProvider = Parameters<Monaco['languages']['registerHoverProvider']>[1];
type ProvideHover = NonNullable<HoverProvider['provideHover']>;
type HoverModel = Parameters<ProvideHover>[0];
type HoverPosition = Parameters<ProvideHover>[1];

function kindLabel(hover: LanguageIntelligenceHover): string {
  const key =
    hover.kind === 'function'
      ? 'languageIntelligence.ruby.hover.methodLabel'
      : hover.kind === 'class'
        ? 'languageIntelligence.ruby.hover.classLabel'
        : hover.kind === 'module'
          ? 'languageIntelligence.ruby.hover.moduleLabel'
          : 'languageIntelligence.ruby.hover.variableLabel';
  return i18next.t(key);
}

export function createRubyHoverProvider(): HoverProvider {
  return {
    provideHover(model: HoverModel, position: HoverPosition) {
      const hover = provideRubyHover(model.getValue(), position.lineNumber, position.column);
      if (!hover) return null;

      const word = model.getWordAtPosition(position);
      if (!word || word.word !== hover.symbol) return null;

      const headerLine = hover.secondary
        ? `**${hover.symbol}**${hover.secondary} - ${kindLabel(hover)}`
        : `**${hover.symbol}** - ${kindLabel(hover)}`;
      const footerLine = i18next.t('languageIntelligence.ruby.hover.definedAt', {
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
