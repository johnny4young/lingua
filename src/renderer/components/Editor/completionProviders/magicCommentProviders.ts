import type { Monaco } from '@monaco-editor/react';
import i18next from 'i18next';
import {
  detectJSMagicComments,
  detectPythonMagicComments,
  extractTimeoutMagicComment,
  gitStatusSuppressedByMagicComment,
  gitWatchHeadSuppressedByMagicComment,
  lineTimingRequestedByMagicComment,
  originSuppressedByMagicComment,
} from '../../../utils/magicComments';

export type MagicCommentLanguage = 'javascript' | 'typescript' | 'python';

type CompletionProvider = Parameters<Monaco['languages']['registerCompletionItemProvider']>[1];
type HoverProvider = Parameters<Monaco['languages']['registerHoverProvider']>[1];
type ProvideCompletionItems = NonNullable<CompletionProvider['provideCompletionItems']>;
type CompletionModel = Parameters<ProvideCompletionItems>[0];
type CompletionPosition = Parameters<ProvideCompletionItems>[1];
type ProvideHover = NonNullable<HoverProvider['provideHover']>;
type HoverModel = Parameters<ProvideHover>[0];
type HoverPosition = Parameters<ProvideHover>[1];

type MagicCommentDefinition = {
  label: string;
  insertText: string;
  descriptionKey: string;
  languages?: readonly MagicCommentLanguage[];
};

const MAGIC_COMMENT_DEFINITIONS: readonly MagicCommentDefinition[] = [
  {
    label: '@watch',
    insertText: '@watch ${1:expression}',
    descriptionKey: 'editor.magicComments.watch',
  },
  {
    label: '@timeout',
    insertText: '@timeout ${1:5s}',
    descriptionKey: 'editor.magicComments.timeout',
  },
  {
    label: '@time',
    insertText: '@time',
    descriptionKey: 'editor.magicComments.time',
    languages: ['javascript', 'typescript'],
  },
  {
    label: '@origin off',
    insertText: '@origin off',
    descriptionKey: 'editor.magicComments.originOff',
  },
  {
    label: '@git-ignore-status',
    insertText: '@git-ignore-status',
    descriptionKey: 'editor.magicComments.gitIgnoreStatus',
  },
  {
    label: '@git-watch-head off',
    insertText: '@git-watch-head off',
    descriptionKey: 'editor.magicComments.gitWatchHeadOff',
  },
  {
    label: '=>',
    insertText: '=>',
    descriptionKey: 'editor.magicComments.arrow',
  },
  {
    label: '=> table',
    insertText: '=> table',
    descriptionKey: 'editor.magicComments.arrowTable',
  },
  {
    label: '=> chart',
    insertText: '=> chart',
    descriptionKey: 'editor.magicComments.arrowChart',
  },
  {
    label: '=> image',
    insertText: '=> image',
    descriptionKey: 'editor.magicComments.arrowImage',
  },
  {
    label: '=> html',
    insertText: '=> html',
    descriptionKey: 'editor.magicComments.arrowHtml',
  },
];

type CommentContext = {
  commentStart: number;
  typed: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
};

function findCommentStart(language: MagicCommentLanguage, prefix: string): number {
  const marker = language === 'python' ? '#' : '//';
  let quote: "'" | '"' | '`' | null = null;

  for (let index = 0; index < prefix.length; index += 1) {
    const character = prefix[index];
    if (quote) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }

    if (prefix.startsWith(marker, index)) return index;
  }

  return -1;
}

export function getMagicCommentContext(
  language: MagicCommentLanguage,
  line: string,
  lineNumber: number,
  column: number
): CommentContext | null {
  const prefix = line.slice(0, Math.max(0, column - 1));
  const commentStart = findCommentStart(language, prefix);
  if (commentStart < 0) return null;

  const markerLength = language === 'python' ? 1 : 2;
  const commentBody = prefix.slice(commentStart + markerLength);
  const leadingWhitespace = commentBody.match(/^\s*/u)?.[0].length ?? 0;
  const typed = commentBody.slice(leadingWhitespace);
  if (!/^(?:@[\w-]*|=?>?(?:\s+\w*)?)?$/u.test(typed)) return null;

  const replacementStart = commentStart + markerLength + leadingWhitespace;
  return {
    commentStart,
    typed,
    range: {
      startLineNumber: lineNumber,
      startColumn: replacementStart + 1,
      endLineNumber: lineNumber,
      endColumn: column,
    },
  };
}

function definitionsForLanguage(
  language: MagicCommentLanguage
): readonly MagicCommentDefinition[] {
  return MAGIC_COMMENT_DEFINITIONS.filter(
    definition => !definition.languages || definition.languages.includes(language)
  );
}

function matchingDefinitions(
  language: MagicCommentLanguage,
  typed: string
): readonly MagicCommentDefinition[] {
  const available = definitionsForLanguage(language);
  if (!typed) return available;
  const normalized = typed.toLowerCase();
  return available.filter(definition =>
    definition.label.toLowerCase().startsWith(normalized)
  );
}

function definitionByLabel(label: string): MagicCommentDefinition | null {
  return MAGIC_COMMENT_DEFINITIONS.find(definition => definition.label === label) ?? null;
}

export function createMagicCommentCompletionProvider(
  monaco: Monaco,
  language: MagicCommentLanguage
): CompletionProvider {
  return {
    triggerCharacters: ['@', '='],
    provideCompletionItems(model: CompletionModel, position: CompletionPosition) {
      const context = getMagicCommentContext(
        language,
        model.getLineContent(position.lineNumber),
        position.lineNumber,
        position.column
      );
      if (!context) return { suggestions: [] };

      return {
        suggestions: matchingDefinitions(language, context.typed).map(definition => ({
          label: definition.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: i18next.t('editor.magicComments.detail'),
          documentation: i18next.t(definition.descriptionKey),
          insertText: definition.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: context.range,
        })),
      };
    },
  };
}

function definitionForLine(
  language: MagicCommentLanguage,
  line: string,
  commentStart: number
): MagicCommentDefinition | null {
  const comment = line.slice(commentStart);
  // The runtime detectors need a non-empty expression before an arrow and
  // preserve text before a watch. Use a harmless synthetic prefix so quoted
  // marker text earlier on the line cannot win over the real comment that the
  // editor scanner already located.
  const detectorInput = `0 ${comment}`;
  const detected =
    language === 'python'
      ? detectPythonMagicComments(detectorInput)[0]
      : detectJSMagicComments(detectorInput)[0];
  if (detected?.kind === 'watch') {
    return definitionByLabel('@watch');
  }
  if (detected?.kind === 'arrow') {
    const label = detected.directive ? `=> ${detected.directive}` : '=>';
    return definitionByLabel(label);
  }
  if (extractTimeoutMagicComment(language, comment) !== null) {
    return definitionByLabel('@timeout');
  }
  if (lineTimingRequestedByMagicComment(language, comment)) {
    return definitionByLabel('@time');
  }
  if (originSuppressedByMagicComment(language, comment)) {
    return definitionByLabel('@origin off');
  }
  if (gitStatusSuppressedByMagicComment(language, comment)) {
    return definitionByLabel('@git-ignore-status');
  }
  if (gitWatchHeadSuppressedByMagicComment(language, comment)) {
    return definitionByLabel('@git-watch-head off');
  }
  return null;
}

function exampleFor(language: MagicCommentLanguage, definition: MagicCommentDefinition): string {
  const marker = language === 'python' ? '#' : '//';
  if (definition.label.startsWith('=>')) {
    return `total ${marker}${definition.label}`;
  }
  if (definition.label === '@watch') return `${marker} @watch total`;
  if (definition.label === '@timeout') return `${marker} @timeout 5s`;
  return `${marker} ${definition.label}`;
}

export function createMagicCommentHoverProvider(language: MagicCommentLanguage): HoverProvider {
  return {
    provideHover(model: HoverModel, position: HoverPosition) {
      const line = model.getLineContent(position.lineNumber);
      const commentStart = findCommentStart(language, line);
      if (commentStart < 0 || position.column - 1 < commentStart) return null;

      const definition = definitionForLine(language, line, commentStart);
      if (!definition) return null;

      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: commentStart + 1,
          endLineNumber: position.lineNumber,
          endColumn: line.length + 1,
        },
        contents: [
          {
            value: `**${definition.label}** — ${i18next.t('editor.magicComments.detail')}`,
          },
          { value: i18next.t(definition.descriptionKey) },
          {
            value: i18next.t('editor.magicComments.example', {
              example: exampleFor(language, definition),
            }),
          },
        ],
      };
    },
  };
}
