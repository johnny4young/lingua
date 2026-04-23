import type { Language } from '../types';

export type FormatterFailure =
  | 'unsupported'
  | 'binary-missing'
  | 'parse-error'
  | 'web-unavailable'
  | 'unknown';

export interface FormatterOk {
  ok: true;
  formatted: string;
  changed: boolean;
}

export interface FormatterErr {
  ok: false;
  failure: FormatterFailure;
  message?: string;
}

export type FormatterResult = FormatterOk | FormatterErr;

type PrettierParser = 'babel-ts' | 'babel' | 'json' | 'css' | 'html';

const PRETTIER_PARSER_BY_LANGUAGE: Partial<Record<string, PrettierParser>> = {
  javascript: 'babel',
  typescript: 'babel-ts',
  json: 'json',
  css: 'css',
  html: 'html',
};

/**
 * Languages the formatter has a strategy for. Any other language returns
 * `unsupported` so the save pipeline can skip format-on-save silently.
 */
export function isFormatterSupported(language: Language): boolean {
  return (
    PRETTIER_PARSER_BY_LANGUAGE[language] !== undefined ||
    language === 'go' ||
    language === 'rust' ||
    language === 'python'
  );
}

async function formatWithPrettier(
  parser: PrettierParser,
  source: string
): Promise<FormatterResult> {
  try {
    const [
      { format },
      babelPlugin,
      estreePlugin,
      typescriptPlugin,
      cssPlugin,
      htmlPlugin,
    ] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
      import('prettier/plugins/typescript'),
      import('prettier/plugins/postcss'),
      import('prettier/plugins/html'),
    ]);

    const formatted = await format(source, {
      parser,
      plugins: [
        babelPlugin.default ?? babelPlugin,
        estreePlugin.default ?? estreePlugin,
        typescriptPlugin.default ?? typescriptPlugin,
        cssPlugin.default ?? cssPlugin,
        htmlPlugin.default ?? htmlPlugin,
      ],
    });

    return {
      ok: true,
      formatted,
      changed: formatted !== source,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, failure: 'parse-error', message };
  }
}

async function formatViaIpc(
  language: 'go' | 'rust' | 'python',
  source: string
): Promise<FormatterResult> {
  const bridge = window.lingua?.format;
  if (!bridge) {
    return { ok: false, failure: 'web-unavailable' };
  }

  const invoke =
    language === 'go'
      ? bridge.gofmt
      : language === 'rust'
        ? bridge.rustfmt
        : bridge.python;
  const result = await invoke(source);

  if (result.available === false) {
    return {
      ok: false,
      failure: result.reason === 'web-unavailable' ? 'web-unavailable' : 'binary-missing',
      message: result.error,
    };
  }

  if (!result.success) {
    return {
      ok: false,
      failure: 'parse-error',
      message: result.error,
    };
  }

  return {
    ok: true,
    formatted: result.formatted ?? source,
    changed: (result.formatted ?? source) !== source,
  };
}

/**
 * Format `source` according to `language`. Never throws — failures come back
 * as a discriminated error so the caller can decide whether to surface them.
 */
export async function formatSource(
  language: Language,
  source: string
): Promise<FormatterResult> {
  if (source === '') {
    return { ok: true, formatted: '', changed: false };
  }

  const parser = PRETTIER_PARSER_BY_LANGUAGE[language];
  if (parser) {
    return formatWithPrettier(parser, source);
  }

  if (language === 'go') {
    return formatViaIpc('go', source);
  }

  if (language === 'rust') {
    return formatViaIpc('rust', source);
  }

  if (language === 'python') {
    return formatViaIpc('python', source);
  }

  return { ok: false, failure: 'unsupported' };
}
