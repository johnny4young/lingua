/**
 * internal — self-contained HTML export for a `RunCapsuleV1`.
 *
 * Renders ONE portable `.html` document — code with static syntax
 * colors, output, input, environment metadata — that opens in any
 * browser without the app. Sharing constraints, enforced here rather
 * than promised in copy:
 *
 *   - Zero external requests: no scripts, no fonts, no images, no
 *     links. A `<meta http-equiv="Content-Security-Policy">` of
 *     `default-src 'none'; style-src 'unsafe-inline'` backstops that
 *     even for content a future template edit might sneak in.
 *   - Every interpolated value is HTML-escaped; capsule code/output
 *     can never break out of its `<pre>` into markup.
 *   - The document declares the capsule schema version (visible
 *     footer + `<meta name="lingua-capsule-schema">`), so a reader
 *     knows which contract produced it.
 *
 * The module is pure and renderer-free by design: Monaco owns
 * tokenization, so the renderer passes pre-tokenized lines in (or
 * nothing, for a plain-text fallback), and i18n owns copy, so every
 * user-facing string arrives via `CapsuleHtmlLabels`. That keeps this
 * file unit-testable without a DOM and the exported document fully
 * localized.
 */

import type { RunCapsuleStatus, RunCapsuleV1 } from './runCapsule';

/** MIME hint for the `.html` download / native save. */
export const CAPSULE_HTML_MIME = 'text/html;charset=utf-8';

/** One colored slice of a source line, as tokenized by Monaco. */
export interface CapsuleCodeToken {
  /** Raw source text of the slice (unescaped). */
  text: string;
  /** Monaco token type, e.g. `keyword.js`, `string.sql`. Empty = plain. */
  type: string;
}

/**
 * Every user-facing string in the document, resolved by the caller
 * (i18n interpolations included) so the export matches the app locale.
 */
export interface CapsuleHtmlLabels {
  documentTitle: string;
  codeHeading: string;
  inputHeading: string;
  stdinLabel: string;
  argsLabel: string;
  inputSetLabel: string;
  outputHeading: string;
  stdoutLabel: string;
  stderrLabel: string;
  errorLabel: string;
  noOutput: string;
  environmentHeading: string;
  platformLabel: string;
  runnerLabel: string;
  appVersionLabel: string;
  gitBranchLabel: string;
  gitCommitLabel: string;
  createdLabel: string;
  privacyHeading: string;
  redactionNote: string;
  omittedFieldsLabel: string;
  generatedWith: string;
  schemaNote: string;
  status: Record<RunCapsuleStatus, string>;
}

export interface CapsuleHtmlOptions {
  labels: CapsuleHtmlLabels;
  /** BCP-47 tag for `<html lang>`, e.g. `en` / `es`. */
  locale: string;
  /**
   * Pre-tokenized source lines (one array per line). `null` renders
   * the source as plain escaped text — the fallback when Monaco is
   * unavailable or tokenization failed.
   */
  codeLines?: CapsuleCodeToken[][] | null;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, char => HTML_ESCAPES[char] ?? char);
}

/**
 * Static token palette keyed by the FIRST dot-segment of a Monaco token
 * type (`type.identifier.ts` → `type`). A fixed palette — instead of
 * exporting the live editor theme's CSS — keeps the document
 * deterministic and free of Monaco runtime internals.
 */
const TOKEN_COLORS: Record<string, string> = {
  comment: '#7d8896',
  string: '#98c379',
  keyword: '#c678dd',
  number: '#d19a66',
  regexp: '#e06c75',
  type: '#56b6c2',
  tag: '#e06c75',
  attribute: '#d19a66',
  constant: '#56b6c2',
  metatag: '#61afef',
  namespace: '#56b6c2',
  annotation: '#7d8896',
  operator: '#9da5b4',
  delimiter: '#9da5b4',
};

function colorForTokenType(type: string): string | null {
  if (!type) return null;
  const head = type.split('.', 1)[0];
  return (head && TOKEN_COLORS[head]) ?? null;
}

const STATUS_COLORS: Record<RunCapsuleStatus, string> = {
  success: '#34d399',
  error: '#f87171',
  timeout: '#fbbf24',
  stopped: '#94a3b8',
};

function renderCodeLines(
  content: string,
  codeLines: CapsuleCodeToken[][] | null | undefined
): string {
  const lines: string[] =
    codeLines && codeLines.length > 0
      ? codeLines.map(tokens =>
          tokens
            .map(token => {
              const escaped = escapeHtml(token.text);
              const color = colorForTokenType(token.type);
              return color
                ? `<span style="color:${color}">${escaped}</span>`
                : escaped;
            })
            .join('')
        )
      : content.split(/\r\n|\r|\n/u).map(line => escapeHtml(line));

  return lines.map(line => `<li><code>${line}</code></li>`).join('\n');
}

function metadataRow(label: string, value: string): string {
  return `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function streamBlock(label: string, value: string, tone: 'out' | 'err'): string {
  return `<h3 class="stream-label">${escapeHtml(label)}</h3>
<pre class="stream stream-${tone}">${escapeHtml(value)}</pre>`;
}

const DOCUMENT_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #10141b;
    color: #d7dde6;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 60rem; margin: 0 auto; padding: 2.5rem 1.5rem 3rem; }
  header .brand {
    margin: 0 0 0.35rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #8b97a8;
  }
  h1 { margin: 0 0 0.75rem; font-size: 1.45rem; color: #f2f5f9; word-break: break-word; }
  h2 {
    margin: 2.2rem 0 0.8rem;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #8b97a8;
  }
  .meta { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0; }
  .badge {
    display: inline-block;
    padding: 0.15rem 0.6rem;
    border: 1px solid #2c3543;
    border-radius: 999px;
    font-size: 0.78rem;
    color: #aeb8c6;
    background: #171d27;
  }
  .badge.status { font-weight: 600; }
  ol.code {
    margin: 0;
    padding: 1rem 1rem 1rem 3.4rem;
    background: #0b0f15;
    border: 1px solid #232b38;
    border-radius: 12px;
    overflow-x: auto;
    counter-reset: line;
    list-style: none;
  }
  ol.code li { counter-increment: line; white-space: pre; min-height: 1.4em; }
  ol.code li::before {
    content: counter(line);
    display: inline-block;
    width: 2rem;
    margin-left: -2.5rem;
    margin-right: 0.5rem;
    text-align: right;
    color: #4b5668;
    user-select: none;
  }
  code, pre, .stream {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.86rem;
  }
  .stream-label { margin: 1rem 0 0.4rem; font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: #8b97a8; }
  pre.stream {
    margin: 0;
    padding: 0.85rem 1rem;
    background: #0b0f15;
    border: 1px solid #232b38;
    border-radius: 12px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  pre.stream-err { border-color: #4c2a2e; color: #f3b3b3; }
  .callout {
    margin: 1rem 0 0;
    padding: 0.85rem 1rem;
    border: 1px solid #4c2a2e;
    border-radius: 12px;
    background: #1b1114;
    color: #f3b3b3;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .empty { color: #77828f; font-style: italic; }
  dl { margin: 0; padding: 0.4rem 1rem; background: #131923; border: 1px solid #232b38; border-radius: 12px; }
  dl .row { display: flex; gap: 1rem; padding: 0.45rem 0; border-top: 1px solid #1d2532; }
  dl .row:first-child { border-top: 0; }
  dt { flex: 0 0 10rem; color: #8b97a8; }
  dd { margin: 0; word-break: break-word; }
  .privacy-note { color: #aeb8c6; font-size: 0.88rem; }
  ul.omitted { margin: 0.4rem 0 0; padding-left: 1.2rem; color: #8b97a8; font-size: 0.85rem; }
  footer {
    margin-top: 2.6rem;
    padding-top: 1rem;
    border-top: 1px solid #232b38;
    color: #77828f;
    font-size: 0.8rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.2rem;
  }
`;

/**
 * Build the full standalone HTML document for an ALREADY-SANITIZED
 * capsule. Callers must run `sanitizeRunCapsule` first — this function
 * renders what it is given and applies escaping, not redaction.
 */
export function buildCapsuleHtml(
  capsule: RunCapsuleV1,
  options: CapsuleHtmlOptions
): string {
  const { labels, locale, codeLines } = options;
  const statusLabel = labels.status[capsule.result.status];
  const statusColor = STATUS_COLORS[capsule.result.status];

  const inputRows: string[] = [];
  if (capsule.input.setName) {
    inputRows.push(metadataRow(labels.inputSetLabel, capsule.input.setName));
  }
  if (capsule.input.args && capsule.input.args.length > 0) {
    inputRows.push(metadataRow(labels.argsLabel, capsule.input.args.join(' ')));
  }
  const inputSection =
    inputRows.length > 0 || capsule.input.stdin
      ? `<section>
<h2>${escapeHtml(labels.inputHeading)}</h2>
${inputRows.length > 0 ? `<dl>${inputRows.join('')}</dl>` : ''}
${capsule.input.stdin ? streamBlock(labels.stdinLabel, capsule.input.stdin, 'out') : ''}
</section>`
      : '';

  const outputBlocks: string[] = [];
  if (capsule.result.stdout) {
    outputBlocks.push(streamBlock(labels.stdoutLabel, capsule.result.stdout, 'out'));
  }
  if (capsule.result.stderr) {
    outputBlocks.push(streamBlock(labels.stderrLabel, capsule.result.stderr, 'err'));
  }
  if (capsule.result.errorMessage) {
    outputBlocks.push(
      `<p class="callout"><strong>${escapeHtml(labels.errorLabel)}:</strong> ${escapeHtml(capsule.result.errorMessage)}</p>`
    );
  }
  if (outputBlocks.length === 0) {
    outputBlocks.push(`<p class="empty">${escapeHtml(labels.noOutput)}</p>`);
  }

  const environmentRows = [
    metadataRow(labels.platformLabel, capsule.environment.platform),
    metadataRow(labels.runnerLabel, capsule.environment.runner),
    metadataRow(labels.appVersionLabel, capsule.appVersion),
    metadataRow(labels.createdLabel, capsule.createdAt),
  ];
  if (capsule.environment.git?.branch) {
    environmentRows.push(metadataRow(labels.gitBranchLabel, capsule.environment.git.branch));
  }
  if (capsule.environment.git?.commit) {
    environmentRows.push(metadataRow(labels.gitCommitLabel, capsule.environment.git.commit));
  }

  const privacySection =
    capsule.privacy.omittedFields.length > 0
      ? `<section>
<h2>${escapeHtml(labels.privacyHeading)}</h2>
<p class="privacy-note">${escapeHtml(labels.redactionNote)}</p>
<p class="privacy-note">${escapeHtml(labels.omittedFieldsLabel)}:</p>
<ul class="omitted">${capsule.privacy.omittedFields
          .map(field => `<li>${escapeHtml(field)}</li>`)
          .join('')}</ul>
</section>`
      : '';

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="generator" content="Lingua ${escapeHtml(capsule.appVersion)}">
<meta name="lingua-capsule-schema" content="${capsule.version}">
<meta name="lingua-capsule-id" content="${escapeHtml(capsule.capsuleId)}">
<title>${escapeHtml(labels.documentTitle)} — ${escapeHtml(capsule.tab.name)}</title>
<style>${DOCUMENT_CSS}</style>
</head>
<body>
<main>
<header>
<p class="brand">Lingua</p>
<h1>${escapeHtml(capsule.tab.name)}</h1>
<p class="meta">
<span class="badge">${escapeHtml(capsule.tab.language)}</span>
<span class="badge status" style="color:${statusColor};border-color:${statusColor}40">${escapeHtml(statusLabel)}</span>
<span class="badge">${Math.round(capsule.result.durationMs)}ms</span>
</p>
</header>
<section>
<h2>${escapeHtml(labels.codeHeading)}</h2>
<ol class="code">
${renderCodeLines(capsule.source.content, codeLines)}
</ol>
</section>
${inputSection}
<section>
<h2>${escapeHtml(labels.outputHeading)}</h2>
${outputBlocks.join('\n')}
</section>
<section>
<h2>${escapeHtml(labels.environmentHeading)}</h2>
<dl>${environmentRows.join('')}</dl>
</section>
${privacySection}
<footer>
<span>${escapeHtml(labels.generatedWith)}</span>
<span>${escapeHtml(labels.schemaNote)}</span>
</footer>
</main>
</body>
</html>
`;
}

/**
 * Deterministic download name: language + capsule creation date +
 * short capsule id, e.g. `lingua-capsule-javascript-2026-05-21-00000000.html`.
 * The id fragment keeps two same-day exports from clobbering each other.
 */
export function capsuleHtmlFilename(capsule: RunCapsuleV1): string {
  const language = capsule.tab.language.replace(/[^a-z0-9-]/giu, '') || 'run';
  const day = capsule.createdAt.slice(0, 10);
  const idFragment = capsule.capsuleId.replace(/[^a-z0-9]/giu, '').slice(0, 8);
  return `lingua-capsule-${language}-${day}-${idFragment}.html`;
}
