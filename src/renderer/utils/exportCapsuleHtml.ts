/**
 * internal — renderer orchestration for the capsule → HTML export.
 *
 * Pipeline: `sanitizeRunCapsule` → static Monaco tokenization (best
 * effort — a failure or an unknown language falls back to plain
 * escaped text, never blocks the export) → `buildCapsuleHtml` with
 * i18n-resolved labels → native Save dialog on desktop / blob download
 * on web (`saveOrDownloadTextFile`) → `capsule.exported` telemetry +
 * a metadata-only trust event once the file actually left the app.
 *
 * Telemetry mirrors `exportCapsuleToClipboard`: it fires before the
 * save attempt (fire-and-forget) so adoption is measurable even when
 * the user cancels the dialog; the trust event fires ONLY after a
 * successful save/download, because a cancelled dialog means nothing
 * left the app.
 */

import type { TFunction } from 'i18next';
import {
  bucketCapsuleSize,
  sanitizeRunCapsule,
  utf8ByteLength,
  type RunCapsuleV1,
} from '../../shared/runCapsule';
import {
  buildCapsuleHtml,
  capsuleHtmlFilename,
  CAPSULE_HTML_MIME,
  type CapsuleCodeToken,
  type CapsuleHtmlLabels,
} from '../../shared/capsuleHtmlExport';
import type { Language } from '../types';
import { monacoLanguageFor } from './languageMeta';
import { saveOrDownloadTextFile } from './saveTextFileToDisk';
import { trackEvent } from './telemetry';
import { recordTrustEventBestEffort } from '../stores/trustEventStore';

/**
 * Surfaces that can trigger the HTML export. Closed enum — each value
 * must exist in `CAPSULE_EXPORT_TRIGGERS` (shared telemetry allowlist
 * + its update-server mirror).
 */
export type CapsuleHtmlExportTrigger = 'settings-export-html' | 'list-export-html';

/**
 * Sources above this length skip tokenization (plain text fallback).
 * Tokenizing a megabyte source would block the renderer for longer
 * than the color adds value; the capsule JSON cap is 4 MiB, so a
 * pathological source can approach that.
 */
const MAX_TOKENIZE_CHARS = 200_000;

/** Minimal shape of `monaco.editor.tokenize` output we consume. */
interface MonacoLineToken {
  offset: number;
  type: string;
}

async function tokenizeCapsuleSource(
  language: string,
  content: string
): Promise<CapsuleCodeToken[][] | null> {
  if (content.length === 0 || content.length > MAX_TOKENIZE_CHARS) return null;
  try {
    const { getConfiguredMonaco, registerLanguageOnce } = await import('../monaco');
    const monaco = getConfiguredMonaco();
    const languageId = monacoLanguageFor(language as Language);
    if (languageId === 'plaintext') return null;
    await registerLanguageOnce(monaco, languageId);
    // Some contributions (JSON) register their tokenizer through an
    // `onLanguage` callback that static tokenization alone does not
    // activate — prime it with a throwaway model + empty colorize,
    // the same dance as `JsonSyntaxOutput.ensureJsonTokenizer`.
    const model = monaco.editor.createModel('', languageId);
    try {
      await monaco.editor.colorize('', languageId);
    } finally {
      model.dispose();
    }
    const tokenLines = monaco.editor.tokenize(content, languageId) as MonacoLineToken[][];
    const textLines = content.split(/\r\n|\r|\n/u);
    // A line-count mismatch means our splitter disagrees with Monaco's;
    // colored-but-wrong code is worse than plain code, so bail out.
    if (tokenLines.length !== textLines.length) return null;
    return tokenLines.map((tokens, lineIndex) => {
      const text = textLines[lineIndex] ?? '';
      return tokens.map((token, tokenIndex) => {
        const end = tokens[tokenIndex + 1]?.offset ?? text.length;
        return { text: text.slice(token.offset, end), type: token.type };
      });
    });
  } catch {
    return null;
  }
}

function buildLabels(t: TFunction, capsule: RunCapsuleV1): CapsuleHtmlLabels {
  return {
    documentTitle: t('capsuleHtml.documentTitle'),
    codeHeading: t('capsuleHtml.code'),
    inputHeading: t('capsuleHtml.input'),
    stdinLabel: t('capsuleHtml.stdin'),
    argsLabel: t('capsuleHtml.args'),
    inputSetLabel: t('capsuleHtml.inputSet'),
    outputHeading: t('capsuleHtml.output'),
    stdoutLabel: t('capsuleHtml.stdout'),
    stderrLabel: t('capsuleHtml.stderr'),
    errorLabel: t('capsuleHtml.error'),
    noOutput: t('capsuleHtml.noOutput'),
    environmentHeading: t('capsuleHtml.environment'),
    platformLabel: t('capsuleHtml.platform'),
    runnerLabel: t('capsuleHtml.runner'),
    appVersionLabel: t('capsuleHtml.appVersion'),
    gitBranchLabel: t('capsuleHtml.gitBranch'),
    gitCommitLabel: t('capsuleHtml.gitCommit'),
    createdLabel: t('capsuleHtml.created'),
    privacyHeading: t('capsuleHtml.privacy'),
    redactionNote: t('capsuleHtml.redactionNote', {
      version: capsule.privacy.redactionVersion,
    }),
    omittedFieldsLabel: t('capsuleHtml.omittedFields'),
    generatedWith: t('capsuleHtml.generatedWith', { version: capsule.appVersion }),
    schemaNote: t('capsuleHtml.schemaNote', {
      schema: capsule.version,
      id: capsule.capsuleId,
    }),
    status: {
      success: t('capsuleHtml.status.success'),
      error: t('capsuleHtml.status.error'),
      timeout: t('capsuleHtml.status.timeout'),
      stopped: t('capsuleHtml.status.stopped'),
    },
  };
}

export interface CapsuleHtmlExportContext {
  t: TFunction;
  /** Active app locale, stamped on `<html lang>`. */
  locale: string;
  onOk: () => void;
  onError: () => void;
}

export async function exportCapsuleAsHtml(
  capsule: RunCapsuleV1,
  trigger: CapsuleHtmlExportTrigger,
  context: CapsuleHtmlExportContext
): Promise<void> {
  const sanitised = sanitizeRunCapsule(capsule);
  const codeLines = await tokenizeCapsuleSource(
    sanitised.tab.language,
    sanitised.source.content
  );
  const html = buildCapsuleHtml(sanitised, {
    labels: buildLabels(context.t, sanitised),
    locale: context.locale,
    codeLines,
  });
  const sizeBucket = bucketCapsuleSize(utf8ByteLength(html));
  void trackEvent('capsule.exported', { trigger, sizeBucket });
  await saveOrDownloadTextFile(html, capsuleHtmlFilename(sanitised), CAPSULE_HTML_MIME, {
    onOk: () => {
      // Metadata only — language + size bucket, never document content.
      recordTrustEventBestEffort({
        feature: 'capsule-export',
        action: 'exported',
        sensitivity: 'medium',
        summary: `${sanitised.tab.language} capsule exported as HTML (${sizeBucket})`,
      });
      context.onOk();
    },
    onError: context.onError,
  });
}
