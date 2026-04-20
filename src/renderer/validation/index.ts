import i18next from 'i18next';
import { load as parseYaml } from 'js-yaml';
import type { EditorDiagnostic, Language } from '../types';

/**
 * RL-058 i18n: every diagnostic message and success-state copy below
 * routes through `t()`. The keys live under `validation.<source>.<rule>`
 * so they're discoverable per validator. New messages MUST add the key
 * to both en and es locales — `npm run check:i18n` enforces that.
 */
function t(key: string, values?: Record<string, string | number>): string {
  return i18next.t(key, { ...values, defaultValue: key });
}

export interface ValidationResult {
  diagnostics: EditorDiagnostic[];
  fullOutput: string;
  executionTime: number;
}

type Validator = (content: string) => EditorDiagnostic[];

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function locationFromOffset(content: string, offset: number): Pick<EditorDiagnostic, 'line' | 'column'> {
  const boundedOffset = Math.max(0, Math.min(offset, content.length));
  const prefix = content.slice(0, boundedOffset);
  const lines = prefix.split('\n');
  const line = Math.max(lines.length, 1);
  const column = (lines.at(-1)?.length ?? 0) + 1;

  return { line, column };
}

function formatDiagnosticsOutput(language: Language, diagnostics: EditorDiagnostic[]): string {
  if (diagnostics.length === 0) {
    const successKeyByLanguage: Partial<Record<Language, string>> = {
      json: 'validation.success.json',
      yaml: 'validation.success.yaml',
      dotenv: 'validation.success.dotenv',
      csv: 'validation.success.csv',
      editorconfig: 'validation.success.editorconfig',
      dockerfile: 'validation.success.dockerfile',
      gitignore: 'validation.success.gitignore',
      makefile: 'validation.success.makefile',
      shellscript: 'validation.success.shellscript',
    };
    return t(successKeyByLanguage[language] ?? 'validation.success.fallback');
  }

  return diagnostics
    .map((diagnostic) => {
      const location = diagnostic.column
        ? t('validation.format.locationLineColumn', {
            line: diagnostic.line,
            column: diagnostic.column,
          })
        : t('validation.format.locationLineOnly', { line: diagnostic.line });
      return t('validation.format.line', {
        severity: diagnostic.severity.toUpperCase(),
        location,
        message: diagnostic.message,
      });
    })
    .join('\n');
}

function validateJson(content: string): EditorDiagnostic[] {
  try {
    JSON.parse(content);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const positionMatch = message.match(/position (\d+)/u);
    const offset = positionMatch ? Number(positionMatch[1]) : 0;
    const location = locationFromOffset(content, offset);

    return [
      {
        message,
        line: location.line,
        column: location.column,
        severity: 'error',
        source: 'json',
      },
    ];
  }
}

function validateYaml(content: string): EditorDiagnostic[] {
  try {
    parseYaml(content);
    return [];
  } catch (error) {
    const yamlError = error as { message?: string; mark?: { line?: number; column?: number } };

    return [
      {
        message: yamlError.message ?? t('validation.yaml.invalidDocument'),
        line: (yamlError.mark?.line ?? 0) + 1,
        column: (yamlError.mark?.column ?? 0) + 1,
        severity: 'error',
        source: 'yaml',
      },
    ];
  }
}

function validateDotenv(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const seenKeys = new Map<string, number>();

  for (const [index, line] of content.split('\n').entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
    const equalsIndex = normalized.indexOf('=');
    if (equalsIndex <= 0) {
      diagnostics.push({
        message: t('validation.dotenv.expectedKeyValue'),
        line: lineNumber,
        column: 1,
        severity: 'error',
        source: 'dotenv',
      });
      continue;
    }

    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      diagnostics.push({
        message: t('validation.dotenv.invalidKey', { key }),
        line: lineNumber,
        column: 1,
        severity: 'error',
        source: 'dotenv',
      });
      continue;
    }

    const previousLine = seenKeys.get(key);
    if (previousLine !== undefined) {
      diagnostics.push({
        message: t('validation.dotenv.duplicateKey', { key, previousLine }),
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'dotenv',
      });
      continue;
    }

    seenKeys.set(key, lineNumber);
  }

  return diagnostics;
}

interface ParsedCsvRow {
  cells: string[];
  error?: EditorDiagnostic;
}

function parseCsvLine(line: string, lineNumber: number): ParsedCsvRow {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (inQuotes) {
    return {
      cells,
      error: {
        message: t('validation.dotenv.unclosedQuote'),
        line: lineNumber,
        column: Math.max(line.length, 1),
        severity: 'error',
        source: 'csv',
      },
    };
  }

  cells.push(current);
  return { cells };
}

function validateCsv(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  let expectedColumns: number | null = null;

  for (const [index, line] of content.split('\n').entries()) {
    const lineNumber = index + 1;
    if (!line.trim()) {
      continue;
    }

    const parsed = parseCsvLine(line, lineNumber);
    if (parsed.error) {
      diagnostics.push(parsed.error);
      continue;
    }

    if (expectedColumns === null) {
      expectedColumns = parsed.cells.length;
      continue;
    }

    if (parsed.cells.length !== expectedColumns) {
      diagnostics.push({
        message: t('validation.csv.columnMismatch', {
          expected: expectedColumns,
          actual: parsed.cells.length,
        }),
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'csv',
      });
    }
  }

  return diagnostics;
}

/**
 * EditorConfig known properties (v0.15.x). Values in the map are either a
 * fixed set of allowed values (for enum-style properties) or `null` meaning
 * "free-form value, only the key name is validated". This is intentionally a
 * shallow spec — we flag unknown keys and clearly-wrong enum values, not
 * full glob-pattern sanity or cross-section semantics.
 */
const EDITORCONFIG_KEYS: Record<string, readonly string[] | null> = {
  root: ['true', 'false'],
  indent_style: ['tab', 'space'],
  indent_size: null,
  tab_width: null,
  end_of_line: ['lf', 'cr', 'crlf'],
  charset: ['latin1', 'utf-8', 'utf-8-bom', 'utf-16be', 'utf-16le'],
  trim_trailing_whitespace: ['true', 'false'],
  insert_final_newline: ['true', 'false'],
  max_line_length: null,
};

function validateEditorConfig(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) continue;

    const equalsIndex = rawLine.indexOf('=');
    if (equalsIndex < 0) {
      diagnostics.push({
        message: t('validation.editorconfig.expectedKeyValueOrSection'),
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'editorconfig',
      });
      continue;
    }

    const rawKey = rawLine.slice(0, equalsIndex).trim().toLowerCase();
    const rawValue = rawLine.slice(equalsIndex + 1).trim();
    const allowed = EDITORCONFIG_KEYS[rawKey];

    if (allowed === undefined) {
      diagnostics.push({
        message: t('validation.editorconfig.unknownKey', { key: rawKey }),
        line: lineNumber,
        column: 1,
        severity: 'info',
        source: 'editorconfig',
      });
      continue;
    }

    // indent_size accepts a positive integer or the literal 'tab'.
    if (rawKey === 'indent_size') {
      if (rawValue !== 'tab' && !/^\d+$/.test(rawValue)) {
        diagnostics.push({
          message: t('validation.editorconfig.indentSizeInvalid'),
          line: lineNumber,
          column: equalsIndex + 2,
          severity: 'warning',
          source: 'editorconfig',
        });
      }
      continue;
    }

    if (rawKey === 'tab_width' || rawKey === 'max_line_length') {
      if (!/^\d+$/.test(rawValue)) {
        diagnostics.push({
          message: t('validation.editorconfig.mustBePositiveInteger', { key: rawKey }),
          line: lineNumber,
          column: equalsIndex + 2,
          severity: 'warning',
          source: 'editorconfig',
        });
      }
      continue;
    }

    if (allowed && !allowed.includes(rawValue.toLowerCase())) {
      diagnostics.push({
        message: t('validation.editorconfig.invalidEnumValue', {
          value: rawValue,
          key: rawKey,
          allowed: allowed.join(', '),
        }),
        line: lineNumber,
        column: equalsIndex + 2,
        severity: 'warning',
        source: 'editorconfig',
      });
    }
  }

  return diagnostics;
}

/**
 * Dockerfile instructions we recognize (Docker v26 / OCI reference). Unknown
 * instructions are flagged as info-severity so users catch typos without the
 * noise of false positives on legitimate uppercase keys.
 */
const DOCKERFILE_INSTRUCTIONS: ReadonlySet<string> = new Set([
  'ADD',
  'ARG',
  'CMD',
  'COPY',
  'ENTRYPOINT',
  'ENV',
  'EXPOSE',
  'FROM',
  'HEALTHCHECK',
  'LABEL',
  'ONBUILD',
  'RUN',
  'SHELL',
  'STOPSIGNAL',
  'USER',
  'VOLUME',
  'WORKDIR',
]);

function validateDockerfile(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const lines = content.split('\n');
  let sawContent = false;
  let sawInstruction = false;
  let sawFrom = false;
  // Track EXPOSE / HEALTHCHECK presence so we can remind users that images
  // advertising a port benefit from an orchestrator-readable health probe.
  // Only the first EXPOSE line matters for the reminder location; we still
  // walk the full file so a HEALTHCHECK appearing later silences it.
  let exposeSeenAt: number | null = null;
  let sawHealthcheck = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    sawContent = true;

    const instructionMatch = trimmed.match(/^([A-Za-z]+)(\s+|$)/u);
    if (!instructionMatch) continue;
    const instruction = (instructionMatch[1] ?? '').toUpperCase();

    if (!DOCKERFILE_INSTRUCTIONS.has(instruction) && instruction !== 'MAINTAINER') {
      diagnostics.push({
        message: t('validation.dockerfile.unknownInstruction', { instruction }),
        line: lineNumber,
        column: 1,
        severity: 'info',
        source: 'dockerfile',
      });
      continue;
    }

    if (instruction === 'MAINTAINER') {
      diagnostics.push({
        message: t('validation.dockerfile.maintainerDeprecated'),
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'dockerfile',
      });
      continue;
    }

    if (!sawInstruction && instruction !== 'FROM' && instruction !== 'ARG') {
      diagnostics.push({
        message: t('validation.dockerfile.firstMustBeFrom'),
        line: lineNumber,
        column: 1,
        severity: 'error',
        source: 'dockerfile',
      });
    }
    sawInstruction = true;
    if (instruction === 'FROM') sawFrom = true;

    // `ADD <url>` is almost always a mistake — COPY + explicit fetch is
    // preferred. Flag remote URLs in ADD but leave local paths alone.
    if (instruction === 'ADD') {
      const args = trimmed.slice(instruction.length).trim();
      if (/^https?:\/\//u.test(args)) {
        diagnostics.push({
          message: t('validation.dockerfile.preferRunOverAddUrl'),
          line: lineNumber,
          column: 1,
          severity: 'warning',
          source: 'dockerfile',
        });
      }
    }

    // `FROM image:latest` (or implicit `FROM image` with no tag) yields a
    // non-reproducible build — flag both forms but only at warning severity
    // since some base images legitimately omit the tag.
    if (instruction === 'FROM') {
      const args = trimmed.slice(instruction.length).trim();
      const imageRef = args.split(/\s+/u)[0] ?? '';
      if (imageRef && imageRef !== 'scratch' && !imageRef.startsWith('$')) {
        const hasDigest = imageRef.includes('@sha256:');
        if (!hasDigest) {
          const refWithoutDigest = imageRef.split('@')[0] ?? imageRef;
          const lastSlash = refWithoutDigest.lastIndexOf('/');
          const lastColon = refWithoutDigest.lastIndexOf(':');
          const tag = lastColon > lastSlash ? refWithoutDigest.slice(lastColon + 1) : null;

          if (!tag) {
            diagnostics.push({
              message: t('validation.dockerfile.imageRefNoTag', { imageRef }),
              line: lineNumber,
              column: 1,
              severity: 'warning',
              source: 'dockerfile',
            });
          } else if (tag === 'latest') {
            diagnostics.push({
              message: t('validation.dockerfile.latestTagUnpinned'),
              line: lineNumber,
              column: 1,
              severity: 'warning',
              source: 'dockerfile',
            });
          }
        }
      }
    }

    // `RUN apt-get install …` without `-y` hangs the build waiting for a
    // prompt that will never come. `--no-install-recommends` avoids surprise
    // dependency bloat — recommend the duo together.
    if (instruction === 'RUN') {
      const args = trimmed.slice(instruction.length);
      if (/\bapt(-get)?\s+install\b/u.test(args) && !/\s-y\b|\s--yes\b|\s--assume-yes\b/u.test(args)) {
        diagnostics.push({
          message: t('validation.dockerfile.aptGetMissingFlags'),
          line: lineNumber,
          column: 1,
          severity: 'warning',
          source: 'dockerfile',
        });
      }
    }

    if (instruction === 'EXPOSE' && exposeSeenAt === null) {
      exposeSeenAt = lineNumber;
    }
    if (instruction === 'HEALTHCHECK') {
      sawHealthcheck = true;
    }

    // `USER root` or `USER 0` signals the image runs as root at runtime —
    // informational by default (build images often need it; runtime images
    // shouldn't). Flag only the final resolved identity by matching at the
    // instruction level; the user can still silence per-image via comments.
    if (instruction === 'USER') {
      const arg = (trimmed.slice(instruction.length).trim().split(/\s+/u)[0] ?? '').toLowerCase();
      if (arg === 'root' || arg === '0' || arg === '0:0') {
        diagnostics.push({
          message: t('validation.dockerfile.userRoot'),
          line: lineNumber,
          column: 1,
          severity: 'info',
          source: 'dockerfile',
        });
      }
    }
  }

  if (sawContent && !sawFrom) {
    diagnostics.push({
      message: t('validation.dockerfile.missingFrom'),
      line: 1,
      column: 1,
      severity: 'error',
      source: 'dockerfile',
    });
  }

  if (exposeSeenAt !== null && !sawHealthcheck) {
    diagnostics.push({
      message: t('validation.dockerfile.exposeWithoutHealthcheck'),
      line: exposeSeenAt,
      column: 1,
      severity: 'info',
      source: 'dockerfile',
    });
  }

  return diagnostics;
}

function validateGitignore(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const lines = content.split('\n');
  const seenPatterns = new Map<string, number>();

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Trailing whitespace changes pattern meaning in git (`foo ` != `foo`)
    // unless explicitly escaped with a backslash. This is a classic
    // copy/paste bug that silently makes a pattern ignore nothing.
    if (/[ \t]+$/u.test(rawLine) && !/\\\s+$/u.test(rawLine)) {
      diagnostics.push({
        message: t('validation.gitignore.trailingWhitespace'),
        line: lineNumber,
        column: rawLine.trimEnd().length + 1,
        severity: 'warning',
        source: 'gitignore',
      });
    }

    // The actual pattern; `!` negates, we compare both with and without it
    // so `foo.log` and `!foo.log` count as the same duplicate key.
    const pattern = trimmed.startsWith('!') ? trimmed.slice(1).trim() : trimmed;
    if (!pattern) {
      diagnostics.push({
        message: t('validation.gitignore.emptyNegation'),
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'gitignore',
      });
      continue;
    }

    if (/\\/u.test(trimmed) && !/\\[ #!]/u.test(trimmed)) {
      // Backslash-as-separator is a Windows-path tell; gitignore is POSIX-only.
      diagnostics.push({
        message: t('validation.gitignore.backslashSeparator'),
        line: lineNumber,
        column: 1,
        severity: 'warning',
        source: 'gitignore',
      });
    }

    const previous = seenPatterns.get(pattern);
    if (previous !== undefined) {
      diagnostics.push({
        message: t('validation.gitignore.duplicatePattern', { pattern, previous }),
        line: lineNumber,
        column: 1,
        severity: 'info',
        source: 'gitignore',
      });
      continue;
    }
    seenPatterns.set(pattern, lineNumber);
  }

  return diagnostics;
}

/**
 * Makefile targets that are almost always virtual (no file produced). If we
 * see them defined without being listed under a `.PHONY` directive, Make
 * will happily skip them when a same-named file happens to exist — which is
 * the bug the `.PHONY` reminder wants to prevent.
 */
/**
 * Variables Make, pattern rules, or common build recipes consume implicitly.
 * A user setting CC=clang is not "unused" just because the file never spells
 * `$(CC)` — implicit rules (%.o: %.c) expand it. Skip the unused-variable
 * check for any name in this set.
 */
const IMPLICIT_MAKE_VARIABLES: ReadonlySet<string> = new Set([
  'AR',
  'AS',
  'CC',
  'CXX',
  'CFLAGS',
  'CXXFLAGS',
  'CPPFLAGS',
  'LDFLAGS',
  'LDLIBS',
  'LIBS',
  'RANLIB',
  'MAKE',
  'MAKEFLAGS',
  'SHELL',
  'DESTDIR',
  'PREFIX',
  'TARGET',
  'PROGRAM',
  'VERSION',
]);

function collectReferencedMakefileVars(source: string, sink: Set<string>): void {
  // `$(FOO)` / `${FOO}` / single-char `$X` — we deliberately accept both.
  // The lookbehind avoids capturing `$$` literal dollars.
  const patterns: readonly RegExp[] = [
    /(?<!\$)\$\(([A-Za-z_][A-Za-z0-9_]*)\)/gu,
    /(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu,
    /(?<!\$)\$([A-Za-z_])(?![A-Za-z0-9_])/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) sink.add(match[1]);
    }
  }
}

const COMMON_PHONY_TARGETS: ReadonlySet<string> = new Set([
  'all',
  'build',
  'clean',
  'check',
  'install',
  'lint',
  'release',
  'run',
  'test',
  'uninstall',
]);

function validateMakefile(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const lines = content.split('\n');
  let activeTarget: string | null = null;

  // Track definitions so we can flag duplicate target blocks and also know
  // which common-phony targets lack a `.PHONY` declaration.
  const definedTargets = new Map<string, number>();
  const phonyTargets = new Set<string>();
  // Track variable assignments so we can flag ones that are never expanded
  // anywhere in the file. Implicit variables (CC/CXX/CFLAGS/...) are skipped
  // because they're set by the user but consumed by Make's built-in rules.
  const assignedVars = new Map<string, number>();
  const referencedVars = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const lineNumber = index + 1;

    if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
      activeTarget = null;
      continue;
    }

    // Capture variable references BEFORE any branch's `continue` so recipes
    // (tab-indented lines) and assignment RHS both count toward the used
    // set. This is what keeps `CC = gcc` followed by `\t$(CC) -o` honest.
    collectReferencedMakefileVars(rawLine, referencedVars);

    // Recipe lines must start with a literal tab. Space-indented recipes are
    // the classic "missing separator" footgun; flag them specifically.
    if (/^ +\S/u.test(rawLine)) {
      if (activeTarget) {
        diagnostics.push({
          message: t('validation.makefile.spaceIndentedRecipe', { target: activeTarget }),
          line: lineNumber,
          column: 1,
          severity: 'error',
          source: 'makefile',
        });
      }
      continue;
    }

    if (rawLine.startsWith('\t')) {
      if (!activeTarget) {
        diagnostics.push({
          message: t('validation.makefile.orphanTabCommand'),
          line: lineNumber,
          column: 1,
          severity: 'error',
          source: 'makefile',
        });
      }
      continue;
    }

    // Target line: `name: deps`. Anything with a colon before any `=`.
    const colonIndex = rawLine.indexOf(':');
    const equalsIndex = rawLine.indexOf('=');
    const isAssignment = equalsIndex >= 0 && (colonIndex < 0 || equalsIndex < colonIndex);

    if (isAssignment) {
      // Support `:=` / `?=` / `+=` / `!=` by normalizing the LHS split.
      const assignSplit = rawLine.split(/[:?+!]?=/u, 1)[0] ?? '';
      const varName = assignSplit.trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(varName) && !assignedVars.has(varName)) {
        assignedVars.set(varName, lineNumber);
      }
      activeTarget = null;
      continue;
    }

    if (!isAssignment && colonIndex > 0) {
      const lhs = rawLine.slice(0, colonIndex).trim();

      // `.PHONY: clean test install` — absorb every name into the set so
      // we can skip the reminder for targets the user already declared.
      if (lhs === '.PHONY') {
        const names = rawLine
          .slice(colonIndex + 1)
          .trim()
          .split(/\s+/u)
          .filter(Boolean);
        for (const name of names) phonyTargets.add(name);
        activeTarget = null;
        continue;
      }

      // Target lines can declare multiple names at once (`a b c: deps`).
      // Split on whitespace to catch duplicates across combined forms too.
      const targetNames = lhs.split(/\s+/u).filter(Boolean);
      const firstTarget = targetNames[0];
      if (firstTarget) {
        for (const name of targetNames) {
          const previous = definedTargets.get(name);
          if (previous !== undefined) {
            diagnostics.push({
              message: t('validation.makefile.duplicateTarget', { name, previous }),
              line: lineNumber,
              column: 1,
              severity: 'warning',
              source: 'makefile',
            });
          } else {
            definedTargets.set(name, lineNumber);
          }
        }
        activeTarget = firstTarget;
        continue;
      }
    }

    activeTarget = null;
  }

  for (const [target, line] of definedTargets) {
    if (COMMON_PHONY_TARGETS.has(target) && !phonyTargets.has(target)) {
      diagnostics.push({
        message: t('validation.makefile.missingPhony', { target }),
        line,
        column: 1,
        severity: 'info',
        source: 'makefile',
      });
    }
  }

  for (const [name, line] of assignedVars) {
    if (IMPLICIT_MAKE_VARIABLES.has(name)) continue;
    if (referencedVars.has(name)) continue;
    diagnostics.push({
      message: t('validation.makefile.unusedVariable', { name }),
      line,
      column: 1,
      severity: 'info',
      source: 'makefile',
    });
  }

  return diagnostics;
}

/**
 * Check a shell script for the two portability footguns that trip up almost
 * every beginner bash file: a missing shebang (which makes the script's
 * interpreter dependent on whatever invoked it) and no safety-mode flag
 * (`set -e`, `set -u`, or `set -o pipefail`). We deliberately do NOT try to
 * lint syntax — shellcheck is the right tool for that and an in-browser
 * reimplementation is out of scope.
 */
function validateShellScript(content: string): EditorDiagnostic[] {
  const diagnostics: EditorDiagnostic[] = [];
  const lines = content.split('\n');
  const firstLine = lines[0] ?? '';
  const hasContent = lines.some((line) => line.trim().length > 0);
  if (!hasContent) return diagnostics;

  if (!firstLine.startsWith('#!')) {
    diagnostics.push({
      message: t('validation.shellscript.missingShebang'),
      line: 1,
      column: 1,
      severity: 'warning',
      source: 'shellscript',
    });
  }

  const hasSafetyMode = lines.some((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('set ')) return false;
    return (
      /\s-e\b|\s-u\b|\s-o\s+pipefail\b|\s-eu\b|\s-euo\s+pipefail\b|\s-eu\s+pipefail\b/u.test(
        ' ' + trimmed
      ) ||
      // Compact forms: `set -eu`, `set -euo pipefail`
      /\s-[eu]{1,3}o?\b/u.test(' ' + trimmed)
    );
  });

  if (!hasSafetyMode) {
    diagnostics.push({
      message: t('validation.shellscript.missingSafetyMode'),
      line: firstLine.startsWith('#!') ? 2 : 1,
      column: 1,
      severity: 'info',
      source: 'shellscript',
    });
  }

  return diagnostics;
}

const validators: Partial<Record<Language, Validator>> = {
  json: validateJson,
  yaml: validateYaml,
  dotenv: validateDotenv,
  csv: validateCsv,
  editorconfig: validateEditorConfig,
  dockerfile: validateDockerfile,
  gitignore: validateGitignore,
  makefile: validateMakefile,
  shellscript: validateShellScript,
};

export function supportsValidation(language: Language): boolean {
  return language in validators;
}

export function validateDocument(language: Language, content: string): ValidationResult {
  const startedAt = now();
  const diagnostics = validators[language]?.(content) ?? [];
  const executionTime = now() - startedAt;

  return {
    diagnostics,
    fullOutput: formatDiagnosticsOutput(language, diagnostics),
    executionTime,
  };
}
