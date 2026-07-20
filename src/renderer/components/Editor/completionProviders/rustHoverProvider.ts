import type { Monaco } from '@monaco-editor/react';
import i18next from 'i18next';
import {
  getRustLspAdapter,
  isRustLspAvailable,
} from '../../../languageIntelligence/rustAdapterSingleton';

type HoverProvider = Parameters<Monaco['languages']['registerHoverProvider']>[1];
type ProvideHover = NonNullable<HoverProvider['provideHover']>;
type HoverModel = Parameters<ProvideHover>[0];
type HoverPosition = Parameters<ProvideHover>[1];

/**
 * implementation — Monaco hover provider for Rust. Delegates to the
 * rust-analyzer adapter. The provider self-gates on
 * `isRustLspAvailable()` so the web build short-circuits without ever
 * trying to call IPC.
 */
export function createRustHoverProvider(): HoverProvider {
  return {
    async provideHover(model: HoverModel, position: HoverPosition) {
      if (!isRustLspAvailable()) return null;
      const adapter = getRustLspAdapter();
      if (!adapter) return null;

      const uri = model.uri.toString();
      adapter.openDocument(uri, model.getValue());

      let hover;
      try {
        hover = await adapter.provideHover(uri, position.lineNumber, position.column);
      } catch {
        return null;
      }
      if (!hover) return null;

      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const kindLabel = i18next.t(
        hover.kind === 'function'
          ? 'languageIntelligence.rust.hover.functionLabel'
          : hover.kind === 'class'
            ? 'languageIntelligence.rust.hover.classLabel'
            : hover.kind === 'module'
              ? 'languageIntelligence.rust.hover.moduleLabel'
              : 'languageIntelligence.rust.hover.variableLabel'
      );

      const headerLine = hover.secondary
        ? `**${hover.symbol}** — ${kindLabel}\n\n${hover.secondary}`
        : `**${hover.symbol}** — ${kindLabel}`;

      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        },
        contents: [{ value: headerLine }],
      };
    },
  };
}
