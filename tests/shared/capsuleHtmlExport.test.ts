/**
 * IT2-F7 — the self-contained HTML document builder.
 *
 * The AC this file locks:
 *   - the document declares the capsule schema version,
 *   - zero external requests are possible (no scripts, no src/href,
 *     plus the `default-src 'none'` CSP backstop),
 *   - hostile capsule content stays escaped text and can never break
 *     into markup,
 *   - a typical capsule stays well under the 500 KB sharing budget.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCapsuleHtml,
  capsuleHtmlFilename,
  type CapsuleHtmlLabels,
} from '../../src/shared/capsuleHtmlExport';
import { sanitizeRunCapsule, utf8ByteLength } from '../../src/shared/runCapsule';
import {
  FIXTURE_FULL_TS,
  FIXTURE_LARGE_STDOUT,
  FIXTURE_MINIMAL_JS,
  FIXTURE_PYTHON_ERROR,
} from './runCapsule.fixtures';

const LABELS: CapsuleHtmlLabels = {
  documentTitle: 'Lingua run capsule',
  codeHeading: 'Code',
  inputHeading: 'Input',
  stdinLabel: 'Stdin',
  argsLabel: 'Arguments',
  inputSetLabel: 'Input set',
  outputHeading: 'Output',
  stdoutLabel: 'stdout',
  stderrLabel: 'stderr',
  errorLabel: 'Error',
  noOutput: 'This run produced no output.',
  environmentHeading: 'Environment',
  platformLabel: 'Platform',
  runnerLabel: 'Runner',
  appVersionLabel: 'App version',
  gitBranchLabel: 'Git branch',
  gitCommitLabel: 'Commit',
  createdLabel: 'Created',
  privacyHeading: 'Privacy',
  redactionNote: 'Oversized fields were truncated (redaction rules 2026-05-21).',
  omittedFieldsLabel: 'Omitted fields',
  generatedWith: 'Exported from Lingua 0.0.0-fixture',
  schemaNote: 'Run capsule schema v1 · 00000000-0000-4000-8000-000000000001',
  status: {
    success: 'Success',
    error: 'Error',
    timeout: 'Timeout',
    stopped: 'Stopped',
  },
};

function build(capsule = FIXTURE_MINIMAL_JS, codeLines: Parameters<typeof buildCapsuleHtml>[1]['codeLines'] = null) {
  return buildCapsuleHtml(capsule, { labels: LABELS, locale: 'en', codeLines });
}

describe('buildCapsuleHtml — document contract', () => {
  it('declares the capsule schema version in a meta tag and the footer', () => {
    const html = build();
    expect(html).toContain('<meta name="lingua-capsule-schema" content="1">');
    expect(html).toContain('Run capsule schema v1');
    expect(html).toContain(`<meta name="lingua-capsule-id" content="${FIXTURE_MINIMAL_JS.capsuleId}">`);
  });

  it('cannot trigger any external request: no scripts, no src/href, CSP backstop', () => {
    const html = build(FIXTURE_FULL_TS);
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('src=');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('@import');
    expect(html).not.toContain('url(');
  });

  it('renders code, stdout and the language/status badges', () => {
    const html = build();
    expect(html).toContain('const x = 1 + 2; console.log(x);');
    expect(html).toContain('3\n');
    expect(html).toContain('javascript');
    expect(html).toContain('Success');
    expect(html).toContain(`lang="en"`);
  });

  it('rounds fractional performance.now durations to whole milliseconds', () => {
    const fractional = {
      ...FIXTURE_MINIMAL_JS,
      result: { ...FIXTURE_MINIMAL_JS.result, durationMs: 1.274999976158142 },
    };
    const html = build(fractional);
    expect(html).toContain('>1ms<');
    expect(html).not.toContain('1.274999976158142');
  });

  it('escapes hostile capsule content instead of letting it become markup', () => {
    const hostile = {
      ...FIXTURE_MINIMAL_JS,
      tab: { ...FIXTURE_MINIMAL_JS.tab, name: '</title><script>alert(1)</script>' },
      source: {
        ...FIXTURE_MINIMAL_JS.source,
        content: '</style><img src=x onerror=alert(1)>',
      },
      result: {
        ...FIXTURE_MINIMAL_JS.result,
        stdout: '<iframe src="https://evil.example"></iframe>',
      },
    };
    const html = build(hostile);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('applies token colors when pre-tokenized lines are provided', () => {
    const html = build(FIXTURE_MINIMAL_JS, [
      [
        { text: 'const', type: 'keyword.js' },
        { text: ' x = ', type: '' },
        { text: '1', type: 'number.js' },
      ],
    ]);
    expect(html).toContain('<span style="color:#c678dd">const</span>');
    expect(html).toContain('<span style="color:#d19a66">1</span>');
    // Un-typed slices stay unwrapped plain text.
    expect(html).toContain(' x = ');
  });

  it('shows the error callout and stderr for a failed run', () => {
    const html = build(FIXTURE_PYTHON_ERROR);
    expect(html).toContain('stderr');
    expect(html).toContain('ValueError: boom');
    expect(html).toContain('class="callout"');
  });

  it('lists omitted fields when the sanitizer truncated streams', () => {
    const sanitised = sanitizeRunCapsule(FIXTURE_LARGE_STDOUT);
    expect(sanitised.privacy.omittedFields.length).toBeGreaterThan(0);
    const html = buildCapsuleHtml(sanitised, { labels: LABELS, locale: 'es' });
    expect(html).toContain('Privacy');
    expect(html).toContain(sanitised.privacy.omittedFields[0]!);
    expect(html).toContain('lang="es"');
  });

  it('stays far under the 500 KB budget for a typical capsule', () => {
    const html = build(FIXTURE_FULL_TS);
    expect(utf8ByteLength(html)).toBeLessThan(100_000);
  });
});

describe('capsuleHtmlFilename', () => {
  it('derives a deterministic language + date + id-fragment name', () => {
    expect(capsuleHtmlFilename(FIXTURE_MINIMAL_JS)).toBe(
      'lingua-capsule-javascript-2026-05-21-00000000.html'
    );
  });

  it('strips unsafe characters from the language token', () => {
    const weird = {
      ...FIXTURE_MINIMAL_JS,
      tab: { ...FIXTURE_MINIMAL_JS.tab, language: '../..//etc' },
    };
    expect(capsuleHtmlFilename(weird)).toBe(
      'lingua-capsule-etc-2026-05-21-00000000.html'
    );
  });
});
